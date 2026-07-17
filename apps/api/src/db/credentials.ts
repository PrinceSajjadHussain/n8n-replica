import { pool } from './pool';
import { randomUUID } from 'crypto';
import { encrypt, decrypt } from '../utils/crypto';

export interface CredentialRecord {
  id: string;
  userId: string;
  type: string;
  encryptedData: string;
  createdAt: Date;
}

export interface CredentialPublic {
  id: string;
  type: string;
  createdAt: Date;
}

export async function createCredential(
  userId: string,
  type: string,
  secretData: Record<string, unknown>
): Promise<CredentialPublic> {
  const id = randomUUID();
  const encryptedData = encrypt(JSON.stringify(secretData));
  const result = await pool.query(
    `INSERT INTO "Credential" (id, "userId", type, "encryptedData")
     VALUES ($1, $2, $3, $4)
     RETURNING id, type, "createdAt"`,
    [id, userId, type, encryptedData]
  );
  return result.rows[0];
}

export async function listCredentials(userId: string): Promise<CredentialPublic[]> {
  const result = await pool.query(
    `SELECT id, type, "createdAt" FROM "Credential" WHERE "userId" = $1 ORDER BY "createdAt" DESC`,
    [userId]
  );
  return result.rows;
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
  const result = await pool.query(
    `SELECT "encryptedData" FROM "Credential" WHERE id = $1 AND "userId" = $2`,
    [id, userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return JSON.parse(decrypt(row.encryptedData));
}
