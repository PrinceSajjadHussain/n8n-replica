import { randomUUID } from 'crypto';
import { pool } from './pool';

export type SsoProtocol = 'saml' | 'oidc' | 'ldap';

export interface SamlConfig {
  entryPoint: string; // IdP SSO URL
  issuer: string; // our SP entity id
  cert: string; // IdP signing certificate (PEM, no headers needed)
  callbackUrl: string;
  wantAssertionsSigned?: boolean;
}

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  authorizationURL: string;
  tokenURL: string;
  userInfoURL: string;
  redirectUri: string;
  scope?: string;
}

export interface LdapConfig {
  url: string; // ldap://host:389 or ldaps://host:636
  bindDN: string;
  bindCredentials: string;
  searchBase: string;
  searchFilter: string; // e.g. "(uid={{username}})"
  tlsRejectUnauthorized?: boolean;
}

export interface SsoConnectionRow {
  id: string;
  workspaceId: string | null;
  protocol: SsoProtocol;
  name: string;
  config: SamlConfig | OidcConfig | LdapConfig;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function createSsoConnection(input: {
  workspaceId?: string | null;
  protocol: SsoProtocol;
  name: string;
  config: unknown;
  createdBy: string;
}): Promise<SsoConnectionRow> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "SsoConnection" (id, "workspaceId", protocol, name, config, "createdBy", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING *`,
    [id, input.workspaceId ?? null, input.protocol, input.name, JSON.stringify(input.config), input.createdBy]
  );
  return result.rows[0];
}

export async function listSsoConnections(workspaceId?: string | null): Promise<SsoConnectionRow[]> {
  const result = workspaceId
    ? await pool.query(`SELECT * FROM "SsoConnection" WHERE "workspaceId" = $1 ORDER BY "createdAt" DESC`, [workspaceId])
    : await pool.query(`SELECT * FROM "SsoConnection" WHERE "workspaceId" IS NULL ORDER BY "createdAt" DESC`);
  return result.rows;
}

export async function getSsoConnection(id: string): Promise<SsoConnectionRow | null> {
  const result = await pool.query(`SELECT * FROM "SsoConnection" WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function setSsoConnectionActive(id: string, isActive: boolean): Promise<void> {
  await pool.query(`UPDATE "SsoConnection" SET "isActive" = $2, "updatedAt" = now() WHERE id = $1`, [id, isActive]);
}

export async function deleteSsoConnection(id: string): Promise<void> {
  await pool.query(`DELETE FROM "SsoConnection" WHERE id = $1`, [id]);
}
