import { Router } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import {
  createCredential,
  listCredentials,
  deleteCredential,
  getCredentialAccess,
  getCredentialRecord,
  updateCredentialMeta,
  recordTestResult,
  createFolder,
  listFolders,
  renameFolder,
  deleteFolder,
  listShares,
  shareCredential,
  unshareCredential,
} from '../db/credentials';
import { findUserPublicByEmail } from '../db/users';
import { testCredentialConnection } from '../utils/credentialTest';
import { OAUTH_PROVIDERS, getProviderConfig, getRedirectUri } from '../config/oauthProviders';
import { createOAuthState, consumeOAuthState } from '../utils/oauthState';

export const credentialsRouter = Router();

// The OAuth callback is hit directly by the provider (no bearer token available), so it must be
// registered before the blanket requireAuth below.
credentialsRouter.get('/oauth/:provider/callback', async (req, res) => {
  const { provider } = req.params;
  const { code, state, error: providerError } = req.query as Record<string, string>;
  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';

  const entry = typeof state === 'string' ? consumeOAuthState(state) : null;
  if (!entry) {
    return res.redirect(`${webOrigin}/credentials?oauth_error=invalid_state`);
  }
  if (providerError) {
    return res.redirect(`${entry.redirectFrontendUrl}?oauth_error=${encodeURIComponent(providerError)}`);
  }

  try {
    const config = getProviderConfig(provider);
    const clientId = process.env[config.clientIdEnv];
    const clientSecret = process.env[config.clientSecretEnv];
    if (!clientId || !clientSecret) {
      return res.redirect(`${entry.redirectFrontendUrl}?oauth_error=provider_not_configured`);
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: getRedirectUri(provider),
      grant_type: 'authorization_code',
    });

    const tokenRes = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
    const tokenJson = (await tokenRes.json()) as Record<string, unknown>;

    // Slack nests the bot/user token under a slightly different shape.
    const accessToken = (tokenJson.access_token ?? (tokenJson.authed_user as any)?.access_token) as
      | string
      | undefined;
    if (!tokenRes.ok || !accessToken) {
      return res.redirect(`${entry.redirectFrontendUrl}?oauth_error=token_exchange_failed`);
    }

    const refreshToken = tokenJson.refresh_token as string | undefined;
    const expiresIn = tokenJson.expires_in as number | undefined;
    const oauthExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

    await createCredential(
      entry.userId,
      config.credentialType,
      { accessToken, refreshToken, raw: tokenJson },
      {
        name: `${config.displayName} connection`,
        authType: 'oauth2',
        oauthProvider: provider,
        oauthExpiresAt,
      }
    );

    return res.redirect(`${entry.redirectFrontendUrl}?oauth_success=${provider}`);
  } catch (err) {
    console.error('OAuth callback failed', err);
    return res.redirect(`${entry.redirectFrontendUrl}?oauth_error=unexpected`);
  }
});

credentialsRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// OAuth: "Connect with ..." — kicks off the authorize redirect
// ---------------------------------------------------------------------------

credentialsRouter.get('/oauth/providers', (_req, res) => {
  const providers = Object.entries(OAUTH_PROVIDERS).map(([id, cfg]) => ({
    id,
    displayName: cfg.displayName,
    configured: Boolean(process.env[cfg.clientIdEnv] && process.env[cfg.clientSecretEnv]),
  }));
  res.json({ providers });
});

credentialsRouter.get('/oauth/:provider/authorize', (req: AuthedRequest, res) => {
  const { provider } = req.params;
  let config;
  try {
    config = getProviderConfig(provider);
  } catch {
    return res.status(404).json({ error: 'Unknown OAuth provider' });
  }
  const clientId = process.env[config.clientIdEnv];
  if (!clientId) {
    return res.status(400).json({
      error: `${config.displayName} OAuth is not configured on this server (missing ${config.clientIdEnv}).`,
    });
  }

  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  const state = createOAuthState(req.userId!, provider, `${webOrigin}/credentials`);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(provider),
    response_type: 'code',
    scope: config.scope,
    state,
    ...(config.extraAuthorizeParams ?? {}),
  });

  res.json({ authorizeUrl: `${config.authorizeUrl}?${params.toString()}` });
});

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

credentialsRouter.get('/folders', async (req: AuthedRequest, res) => {
  res.json({ folders: await listFolders(req.userId!) });
});

credentialsRouter.post('/folders', async (req: AuthedRequest, res) => {
  const parsed = z.object({ name: z.string().min(1).max(80) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json({ folder: await createFolder(req.userId!, parsed.data.name) });
});

credentialsRouter.patch('/folders/:id', async (req: AuthedRequest, res) => {
  const parsed = z.object({ name: z.string().min(1).max(80) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const ok = await renameFolder(req.params.id, req.userId!, parsed.data.name);
  if (!ok) return res.status(404).json({ error: 'Folder not found' });
  res.status(204).send();
});

credentialsRouter.delete('/folders/:id', async (req: AuthedRequest, res) => {
  const ok = await deleteFolder(req.params.id, req.userId!);
  if (!ok) return res.status(404).json({ error: 'Folder not found' });
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Credentials CRUD
// ---------------------------------------------------------------------------

const createSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  data: z.record(z.unknown()),
  folderId: z.string().uuid().nullable().optional(),
});

credentialsRouter.get('/', async (req: AuthedRequest, res) => {
  const credentials = await listCredentials(req.userId!);
  res.json({ credentials }); // never includes encryptedData or decrypted secrets
});

credentialsRouter.post('/', async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const credential = await createCredential(req.userId!, parsed.data.type, parsed.data.data, {
    name: parsed.data.name,
    folderId: parsed.data.folderId ?? null,
  });
  res.status(201).json({ credential });
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  folderId: z.string().uuid().nullable().optional(),
});

credentialsRouter.patch('/:id', async (req: AuthedRequest, res) => {
  const access = await getCredentialAccess(req.params.id, req.userId!);
  if (!access) return res.status(404).json({ error: 'Credential not found' });
  if (access === 'use') return res.status(403).json({ error: 'You only have "use" access to this credential.' });
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const credential = await updateCredentialMeta(req.params.id, parsed.data);
  res.json({ credential });
});

credentialsRouter.delete('/:id', async (req: AuthedRequest, res) => {
  const deleted = await deleteCredential(req.params.id, req.userId!);
  if (!deleted) return res.status(404).json({ error: 'Credential not found or you are not the owner.' });
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Test connection
// ---------------------------------------------------------------------------

credentialsRouter.post('/:id/test', async (req: AuthedRequest, res) => {
  const access = await getCredentialAccess(req.params.id, req.userId!);
  if (!access) return res.status(404).json({ error: 'Credential not found' });

  const record = await getCredentialRecord(req.params.id);
  if (!record) return res.status(404).json({ error: 'Credential not found' });

  const { decrypt } = await import('../utils/crypto');
  const data = JSON.parse(decrypt(record.encryptedData)) as Record<string, unknown>;
  const result = await testCredentialConnection(record.type, data);
  await recordTestResult(req.params.id, result.ok, result.message);
  res.json({ ...result, testedAt: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Sharing / permissions
// ---------------------------------------------------------------------------

credentialsRouter.get('/:id/shares', async (req: AuthedRequest, res) => {
  const access = await getCredentialAccess(req.params.id, req.userId!);
  if (access !== 'owner') return res.status(403).json({ error: 'Only the owner can view sharing settings.' });
  res.json({ shares: await listShares(req.params.id) });
});

const shareSchema = z.object({
  email: z.string().email(),
  permission: z.enum(['use', 'manage']).default('use'),
});

credentialsRouter.post('/:id/shares', async (req: AuthedRequest, res) => {
  const access = await getCredentialAccess(req.params.id, req.userId!);
  if (access !== 'owner') return res.status(403).json({ error: 'Only the owner can share this credential.' });
  const parsed = shareSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const targetUser = await findUserPublicByEmail(parsed.data.email);
  if (!targetUser) return res.status(404).json({ error: 'No user found with that email.' });
  if (targetUser.id === req.userId) return res.status(400).json({ error: 'You already own this credential.' });

  const share = await shareCredential(req.params.id, targetUser.id, parsed.data.permission);
  res.status(201).json({ share });
});

credentialsRouter.delete('/:id/shares/:userId', async (req: AuthedRequest, res) => {
  const access = await getCredentialAccess(req.params.id, req.userId!);
  if (access !== 'owner') return res.status(403).json({ error: 'Only the owner can manage sharing.' });
  const ok = await unshareCredential(req.params.id, req.params.userId);
  if (!ok) return res.status(404).json({ error: 'Share not found' });
  res.status(204).send();
});
