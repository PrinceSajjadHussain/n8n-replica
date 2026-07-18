import { Router } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { requireSystemRole } from '../middleware/rbac';
import {
  createSsoConnection,
  listSsoConnections,
  getSsoConnection,
  setSsoConnectionActive,
  deleteSsoConnection,
  type SamlConfig,
  type LdapConfig,
} from '../db/sso';
import { generateServiceProviderMetadata, getSamlLoginUrl, validateSamlResponse } from '../utils/saml';
import { authenticateLdapUser, testLdapConnection } from '../utils/ldap';
import { findOrCreateSsoUser } from '../db/users';
import { signAccessToken, signRefreshToken } from '../utils/jwt';
import { auditFromRequest } from '../utils/audit';

/** Mounted at /auth/sso. Admin config endpoints require `admin` system role;
 *  the actual login handshake (start/callback) is public, same as any IdP
 *  login entry point. */
export const ssoRouter = Router();

const samlConfigSchema = z.object({
  entryPoint: z.string().url(),
  issuer: z.string().min(1),
  cert: z.string().min(1),
  callbackUrl: z.string().url(),
  wantAssertionsSigned: z.boolean().optional(),
});

const ldapConfigSchema = z.object({
  url: z.string().min(1),
  bindDN: z.string().min(1),
  bindCredentials: z.string().min(1),
  searchBase: z.string().min(1),
  searchFilter: z.string().min(1),
  tlsRejectUnauthorized: z.boolean().optional(),
});

const oidcConfigSchema = z.object({
  issuer: z.string().url(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  authorizationURL: z.string().url(),
  tokenURL: z.string().url(),
  userInfoURL: z.string().url(),
  redirectUri: z.string().url(),
  scope: z.string().optional(),
});

const createConnectionSchema = z.object({
  workspaceId: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  protocol: z.enum(['saml', 'oidc', 'ldap']),
  config: z.unknown(),
});

/** GET /auth/sso/connections — list configured IdP connections (admin). */
ssoRouter.get('/connections', requireAuth, requireSystemRole('admin'), async (req: AuthedRequest, res, next) => {
  try {
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : null;
    const connections = await listSsoConnections(workspaceId);
    res.json({ connections });
  } catch (err) {
    next(err);
  }
});

/** POST /auth/sso/connections — register a new SAML/OIDC/LDAP connection. */
ssoRouter.post('/connections', requireAuth, requireSystemRole('admin'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = createConnectionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { protocol, config } = parsed.data;

    const schema = protocol === 'saml' ? samlConfigSchema : protocol === 'ldap' ? ldapConfigSchema : oidcConfigSchema;
    const configParsed = schema.safeParse(config);
    if (!configParsed.success) return res.status(400).json({ error: configParsed.error.flatten() });

    const connection = await createSsoConnection({
      workspaceId: parsed.data.workspaceId ?? null,
      protocol,
      name: parsed.data.name,
      config: configParsed.data,
      createdBy: req.userId!,
    });
    await auditFromRequest(req, { userId: req.userId, action: 'sso.connection_created', metadata: { connectionId: connection.id, protocol } });
    res.status(201).json({ connection });
  } catch (err) {
    next(err);
  }
});

/** PATCH /auth/sso/connections/:id — enable/disable a connection. */
ssoRouter.patch('/connections/:id', requireAuth, requireSystemRole('admin'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = z.object({ isActive: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    await setSsoConnectionActive(req.params.id, parsed.data.isActive);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** DELETE /auth/sso/connections/:id */
ssoRouter.delete('/connections/:id', requireAuth, requireSystemRole('admin'), async (req: AuthedRequest, res, next) => {
  try {
    await deleteSsoConnection(req.params.id);
    await auditFromRequest(req, { userId: req.userId, action: 'sso.connection_deleted', metadata: { connectionId: req.params.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** POST /auth/sso/connections/:id/test — LDAP-only: verify the service
 *  account can bind, without touching any real user's credentials. */
ssoRouter.post('/connections/:id/test', requireAuth, requireSystemRole('admin'), async (req, res, next) => {
  try {
    const connection = await getSsoConnection(req.params.id);
    if (!connection) return res.status(404).json({ error: 'Connection not found' });
    if (connection.protocol !== 'ldap') return res.status(400).json({ error: 'Connection test only supported for LDAP' });
    const result = await testLdapConnection(connection.config as LdapConfig);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** GET /auth/sso/:id/metadata — SP metadata XML for the IdP admin to import. */
ssoRouter.get('/:id/metadata', async (req, res, next) => {
  try {
    const connection = await getSsoConnection(req.params.id);
    if (!connection || connection.protocol !== 'saml') return res.status(404).send('Not found');
    const xml = generateServiceProviderMetadata(connection.config as SamlConfig);
    res.type('application/xml').send(xml);
  } catch (err) {
    next(err);
  }
});

/** GET /auth/sso/:id/login — redirects the browser into the IdP's login page (SAML). */
ssoRouter.get('/:id/login', async (req, res, next) => {
  try {
    const connection = await getSsoConnection(req.params.id);
    if (!connection || !connection.isActive) return res.status(404).json({ error: 'SSO connection not found or inactive' });
    if (connection.protocol !== 'saml') return res.status(400).json({ error: 'This endpoint is SAML-only; use POST /auth/sso/:id/ldap-login for LDAP' });
    const url = await getSamlLoginUrl(connection.config as SamlConfig, typeof req.query.redirect === 'string' ? req.query.redirect : undefined);
    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

/** POST /auth/sso/:id/acs — SAML assertion consumer service. The IdP posts
 *  the signed assertion here after a successful login; we validate it,
 *  JIT-provision the user, and issue our own session tokens. */
ssoRouter.post('/:id/acs', async (req, res, next) => {
  try {
    const connection = await getSsoConnection(req.params.id);
    if (!connection || !connection.isActive || connection.protocol !== 'saml') {
      return res.status(404).json({ error: 'SSO connection not found or inactive' });
    }
    const profile = await validateSamlResponse(connection.config as SamlConfig, req.body);
    const user = await findOrCreateSsoUser(profile.email);
    const accessToken = signAccessToken(user.id);
    const refreshToken = signRefreshToken(user.id);
    await auditFromRequest(req, { userId: user.id, action: 'auth.sso_login', metadata: { protocol: 'saml', connectionId: connection.id } });
    res.json({ accessToken, refreshToken, user: { id: user.id, email: user.email } });
  } catch (err) {
    next(err);
  }
});

/** GET /auth/sso/:id/oidc/start — redirects into the IdP's OIDC authorize endpoint. */
ssoRouter.get('/:id/oidc/start', async (req, res, next) => {
  try {
    const connection = await getSsoConnection(req.params.id);
    if (!connection || !connection.isActive || connection.protocol !== 'oidc') {
      return res.status(404).json({ error: 'SSO connection not found or inactive' });
    }
    const config = connection.config as z.infer<typeof oidcConfigSchema>;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scope ?? 'openid email profile',
      state: connection.id,
    });
    res.redirect(`${config.authorizationURL}?${params.toString()}`);
  } catch (err) {
    next(err);
  }
});

/** GET /auth/sso/:id/oidc/callback — exchanges the auth code for tokens,
 *  reads the userinfo endpoint for email, and JIT-provisions the user. Uses
 *  plain fetch (no extra OIDC library) since FlowForge only needs the
 *  authorization-code + userinfo happy path, not full discovery/PKCE. */
ssoRouter.get('/:id/oidc/callback', async (req, res, next) => {
  try {
    const connection = await getSsoConnection(req.params.id);
    if (!connection || !connection.isActive || connection.protocol !== 'oidc') {
      return res.status(404).json({ error: 'SSO connection not found or inactive' });
    }
    const code = typeof req.query.code === 'string' ? req.query.code : null;
    if (!code) return res.status(400).json({ error: 'Missing authorization code' });
    const config = connection.config as z.infer<typeof oidcConfigSchema>;

    const tokenRes = await fetch(config.tokenURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });
    if (!tokenRes.ok) return res.status(401).json({ error: 'OIDC token exchange failed' });
    const tokens = (await tokenRes.json()) as { access_token: string };

    const userInfoRes = await fetch(config.userInfoURL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userInfoRes.ok) return res.status(401).json({ error: 'OIDC userinfo lookup failed' });
    const profile = (await userInfoRes.json()) as { email?: string };
    if (!profile.email) return res.status(401).json({ error: 'OIDC provider did not return an email claim' });

    const user = await findOrCreateSsoUser(profile.email);
    const accessToken = signAccessToken(user.id);
    const refreshToken = signRefreshToken(user.id);
    await auditFromRequest(req, { userId: user.id, action: 'auth.sso_login', metadata: { protocol: 'oidc', connectionId: connection.id } });
    res.json({ accessToken, refreshToken, user: { id: user.id, email: user.email } });
  } catch (err) {
    next(err);
  }
});

const ldapLoginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });

/** POST /auth/sso/:id/ldap-login — direct-bind LDAP/AD login (username +
 *  password posted from FlowForge's own login form when an LDAP connection
 *  is configured, rather than a redirect-based handshake). */
ssoRouter.post('/:id/ldap-login', async (req, res, next) => {
  try {
    const connection = await getSsoConnection(req.params.id);
    if (!connection || !connection.isActive || connection.protocol !== 'ldap') {
      return res.status(404).json({ error: 'SSO connection not found or inactive' });
    }
    const parsed = ldapLoginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const ldapUser = await authenticateLdapUser(connection.config as LdapConfig, parsed.data.username, parsed.data.password);
    if (!ldapUser) return res.status(401).json({ error: 'Invalid directory credentials' });

    const user = await findOrCreateSsoUser(ldapUser.email);
    const accessToken = signAccessToken(user.id);
    const refreshToken = signRefreshToken(user.id);
    await auditFromRequest(req, { userId: user.id, action: 'auth.sso_login', metadata: { protocol: 'ldap', connectionId: connection.id } });
    res.json({ accessToken, refreshToken, user: { id: user.id, email: user.email } });
  } catch (err) {
    next(err);
  }
});
