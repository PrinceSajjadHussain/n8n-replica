import { randomUUID } from 'crypto';
import { pool } from './pool';
import { generateApiToken, hashApiToken } from '../utils/apiTokenSecret';

export interface ApiTokenRow {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  tokenHash: string;
  scopes: string[];
  rateLimit: number;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface CreateApiTokenInput {
  userId: string;
  name: string;
  scopes?: string[];
  rateLimit?: number;
  expiresAt?: Date | null;
}

/** Creates a token and returns the row plus the ONE-TIME plaintext secret. */
export async function createApiToken(input: CreateApiTokenInput) {
  const { token, prefix, tokenHash } = generateApiToken();
  const id = randomUUID();
  const scopes = input.scopes ?? ['workflows:read', 'workflows:write', 'executions:read', 'executions:write'];
  const result = await pool.query(
    `INSERT INTO "ApiToken" (id, "userId", name, prefix, "tokenHash", scopes, "rateLimit", "expiresAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [id, input.userId, input.name, prefix, tokenHash, scopes, input.rateLimit ?? 600, input.expiresAt ?? null]
  );
  return { row: result.rows[0] as ApiTokenRow, token };
}

export async function listApiTokens(userId: string): Promise<Omit<ApiTokenRow, 'tokenHash'>[]> {
  const result = await pool.query(
    `SELECT id, "userId", name, prefix, scopes, "rateLimit", "lastUsedAt", "expiresAt", "revokedAt", "createdAt"
     FROM "ApiToken" WHERE "userId" = $1 ORDER BY "createdAt" DESC`,
    [userId]
  );
  return result.rows;
}

export async function revokeApiToken(userId: string, tokenId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE "ApiToken" SET "revokedAt" = now() WHERE id = $1 AND "userId" = $2 AND "revokedAt" IS NULL`,
    [tokenId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Looks up a token by its raw secret (hashed for comparison), returning the
 *  owning user id + scopes if the token is valid, active, and unexpired. */
export async function findValidApiToken(rawToken: string) {
  const tokenHash = hashApiToken(rawToken);
  const result = await pool.query(
    `SELECT * FROM "ApiToken"
     WHERE "tokenHash" = $1 AND "revokedAt" IS NULL
       AND ("expiresAt" IS NULL OR "expiresAt" > now())`,
    [tokenHash]
  );
  const row = result.rows[0] as ApiTokenRow | undefined;
  if (!row) return null;
  await pool.query(`UPDATE "ApiToken" SET "lastUsedAt" = now() WHERE id = $1`, [row.id]);
  return row;
}
