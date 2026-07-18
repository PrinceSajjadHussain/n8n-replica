import { pool } from './pool';
import { randomUUID } from 'crypto';
import { encrypt, decrypt } from '../utils/crypto';

export type SharePermission = 'use' | 'manage';
export type CredentialAuthType = 'apiKey' | 'oauth2';

export interface CredentialRecord {
  id: string;
  userId: string;
  name: string;
  type: string;
  authType: CredentialAuthType;
  encryptedData: string;
  folderId: string | null;
  oauthProvider: string | null;
  oauthExpiresAt: Date | null;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  createdAt: Date;
}

export interface CredentialPublic {
  id: string;
  name: string;
  type: string;
  authType: CredentialAuthType;
  folderId: string | null;
  oauthProvider: string | null;
  oauthExpiresAt: Date | null;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  createdAt: Date;
  /** Present when the credential belongs to someone else and was shared with the caller. */
  owner?: { id: string; email: string };
  /** The caller's effective permission: 'owner' | 'manage' | 'use'. */
  access: 'owner' | 'manage' | 'use';
}

const PUBLIC_COLUMNS = `id, "userId", name, type, "authType", "folderId", "oauthProvider", "oauthExpiresAt",
  "lastTestedAt", "lastTestOk", "lastTestMessage", "createdAt"`;

export async function createCredential(
  userId: string,
  type: string,
  secretData: Record<string, unknown>,
  opts: {
    name?: string;
    authType?: CredentialAuthType;
    folderId?: string | null;
    oauthProvider?: string | null;
    oauthExpiresAt?: Date | null;
  } = {}
): Promise<CredentialPublic> {
  const id = randomUUID();
  const encryptedData = encrypt(JSON.stringify(secretData));
  const result = await pool.query(
    `INSERT INTO "Credential"
       (id, "userId", name, type, "authType", "encryptedData", "folderId", "oauthProvider", "oauthExpiresAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${PUBLIC_COLUMNS}`,
    [
      id,
      userId,
      opts.name ?? type,
      type,
      opts.authType ?? 'apiKey',
      encryptedData,
      opts.folderId ?? null,
      opts.oauthProvider ?? null,
      opts.oauthExpiresAt ?? null,
    ]
  );
  return { ...result.rows[0], access: 'owner' };
}

/** Lists credentials the user owns AND credentials shared with them by others. */
export async function listCredentials(userId: string): Promise<CredentialPublic[]> {
  const owned = await pool.query<CredentialPublic>(
    `SELECT ${PUBLIC_COLUMNS} FROM "Credential" WHERE "userId" = $1 ORDER BY "createdAt" DESC`,
    [userId]
  );
  const shared = await pool.query(
    `SELECT c.id, c."userId", c.name, c.type, c."authType", c."folderId", c."oauthProvider",
            c."oauthExpiresAt", c."lastTestedAt", c."lastTestOk", c."lastTestMessage", c."createdAt",
            cs.permission, u.id AS "ownerId", u.email AS "ownerEmail"
     FROM "CredentialShare" cs
     JOIN "Credential" c ON c.id = cs."credentialId"
     JOIN "User" u ON u.id = c."userId"
     WHERE cs."sharedWithUserId" = $1
     ORDER BY c."createdAt" DESC`,
    [userId]
  );

  const ownedPublic: CredentialPublic[] = owned.rows.map((row) => ({ ...row, access: 'owner' as const }));
  const sharedPublic: CredentialPublic[] = shared.rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    name: row.name,
    type: row.type,
    authType: row.authType,
    folderId: null, // shared credentials don't inherit the sharer's personal folder view
    oauthProvider: row.oauthProvider,
    oauthExpiresAt: row.oauthExpiresAt,
    lastTestedAt: row.lastTestedAt,
    lastTestOk: row.lastTestOk,
    lastTestMessage: row.lastTestMessage,
    createdAt: row.createdAt,
    owner: { id: row.ownerId, email: row.ownerEmail },
    access: row.permission === 'manage' ? 'manage' : 'use',
  }));

  return [...ownedPublic, ...sharedPublic];
}

async function getShare(credentialId: string, userId: string) {
  const result = await pool.query(
    `SELECT permission FROM "CredentialShare" WHERE "credentialId" = $1 AND "sharedWithUserId" = $2`,
    [credentialId, userId]
  );
  return result.rows[0] as { permission: SharePermission } | undefined;
}

/**
 * Resolves what a given user is allowed to do with a credential: 'owner', 'manage', 'use', or
 * null if they have no access at all.
 */
export async function getCredentialAccess(
  credentialId: string,
  userId: string
): Promise<'owner' | 'manage' | 'use' | null> {
  const result = await pool.query(`SELECT "userId" FROM "Credential" WHERE id = $1`, [credentialId]);
  const row = result.rows[0];
  if (!row) return null;
  if (row.userId === userId) return 'owner';
  const share = await getShare(credentialId, userId);
  return share ? share.permission : null;
}

export async function getCredentialRecord(credentialId: string): Promise<CredentialRecord | null> {
  const result = await pool.query(`SELECT * FROM "Credential" WHERE id = $1`, [credentialId]);
  return result.rows[0] ?? null;
}

export async function updateCredentialMeta(
  credentialId: string,
  updates: { name?: string; folderId?: string | null }
): Promise<CredentialPublic | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (updates.name !== undefined) {
    fields.push(`name = $${i++}`);
    values.push(updates.name);
  }
  if (updates.folderId !== undefined) {
    fields.push(`"folderId" = $${i++}`);
    values.push(updates.folderId);
  }
  if (fields.length === 0) return null;
  values.push(credentialId);
  const result = await pool.query(
    `UPDATE "Credential" SET ${fields.join(', ')} WHERE id = $${i} RETURNING ${PUBLIC_COLUMNS}`,
    values
  );
  return result.rows[0] ? { ...result.rows[0], access: 'owner' } : null;
}

export async function recordTestResult(credentialId: string, ok: boolean, message: string): Promise<void> {
  await pool.query(
    `UPDATE "Credential" SET "lastTestedAt" = now(), "lastTestOk" = $2, "lastTestMessage" = $3 WHERE id = $1`,
    [credentialId, ok, message]
  );
}

export async function deleteCredential(id: string, userId: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM "Credential" WHERE id = $1 AND "userId" = $2`, [
    id,
    userId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

/** Internal use only (e.g. by the execution engine) — decrypts secret data for a credential. */
export async function getDecryptedCredential(
  id: string,
  userId: string
): Promise<Record<string, unknown> | null> {
  const access = await getCredentialAccess(id, userId);
  if (!access) return null;
  const result = await pool.query(`SELECT "encryptedData" FROM "Credential" WHERE id = $1`, [id]);
  const row = result.rows[0];
  if (!row) return null;
  return JSON.parse(decrypt(row.encryptedData));
}

export async function setDecryptedData(
  id: string,
  secretData: Record<string, unknown>,
  extra: { oauthExpiresAt?: Date | null } = {}
): Promise<void> {
  const encryptedData = encrypt(JSON.stringify(secretData));
  if (extra.oauthExpiresAt !== undefined) {
    await pool.query(`UPDATE "Credential" SET "encryptedData" = $2, "oauthExpiresAt" = $3 WHERE id = $1`, [
      id,
      encryptedData,
      extra.oauthExpiresAt,
    ]);
  } else {
    await pool.query(`UPDATE "Credential" SET "encryptedData" = $2 WHERE id = $1`, [id, encryptedData]);
  }
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export interface CredentialFolder {
  id: string;
  userId: string;
  name: string;
  createdAt: Date;
}

export async function createFolder(userId: string, name: string): Promise<CredentialFolder> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "CredentialFolder" (id, "userId", name) VALUES ($1, $2, $3) RETURNING *`,
    [id, userId, name]
  );
  return result.rows[0];
}

export async function listFolders(userId: string): Promise<CredentialFolder[]> {
  const result = await pool.query(
    `SELECT * FROM "CredentialFolder" WHERE "userId" = $1 ORDER BY "createdAt" ASC`,
    [userId]
  );
  return result.rows;
}

export async function renameFolder(id: string, userId: string, name: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE "CredentialFolder" SET name = $3 WHERE id = $1 AND "userId" = $2`,
    [id, userId, name]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteFolder(id: string, userId: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM "CredentialFolder" WHERE id = $1 AND "userId" = $2`, [
    id,
    userId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

export interface CredentialShareRecord {
  id: string;
  credentialId: string;
  sharedWithUserId: string;
  sharedWithEmail: string;
  permission: SharePermission;
  createdAt: Date;
}

export async function listShares(credentialId: string): Promise<CredentialShareRecord[]> {
  const result = await pool.query(
    `SELECT cs.id, cs."credentialId", cs."sharedWithUserId", u.email AS "sharedWithEmail",
            cs.permission, cs."createdAt"
     FROM "CredentialShare" cs
     JOIN "User" u ON u.id = cs."sharedWithUserId"
     WHERE cs."credentialId" = $1
     ORDER BY cs."createdAt" ASC`,
    [credentialId]
  );
  return result.rows;
}

export async function shareCredential(
  credentialId: string,
  sharedWithUserId: string,
  permission: SharePermission
): Promise<CredentialShareRecord> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "CredentialShare" (id, "credentialId", "sharedWithUserId", permission)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT ("credentialId", "sharedWithUserId") DO UPDATE SET permission = EXCLUDED.permission
     RETURNING id, "credentialId", "sharedWithUserId", permission, "createdAt"`,
    [id, credentialId, sharedWithUserId, permission]
  );
  const row = result.rows[0];
  const userResult = await pool.query(`SELECT email FROM "User" WHERE id = $1`, [sharedWithUserId]);
  return { ...row, sharedWithEmail: userResult.rows[0]?.email ?? '' };
}

export async function unshareCredential(credentialId: string, sharedWithUserId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM "CredentialShare" WHERE "credentialId" = $1 AND "sharedWithUserId" = $2`,
    [credentialId, sharedWithUserId]
  );
  return (result.rowCount ?? 0) > 0;
}
