import { pool } from './pool';
import { randomUUID } from 'crypto';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export async function createUser(email: string, passwordHash: string): Promise<User> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "User" (id, email, "passwordHash") VALUES ($1, $2, $3)
     RETURNING id, email, "passwordHash", "createdAt"`,
    [id, email, passwordHash]
  );
  return result.rows[0];
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const result = await pool.query(
    `SELECT id, email, "passwordHash", "createdAt" FROM "User" WHERE email = $1`,
    [email]
  );
  return result.rows[0] ?? null;
}

/** Public-safe lookup used for credential sharing (returns id/email only, never the hash). */
export async function findUserPublicByEmail(email: string): Promise<{ id: string; email: string } | null> {
  const result = await pool.query(`SELECT id, email FROM "User" WHERE email = $1`, [email]);
  return result.rows[0] ?? null;
}

/** Just-in-time provisioning for SSO logins (SAML/LDAP): if a user with this
 *  email already exists, sign them in as that user; otherwise create one
 *  with an unusable random password hash (SSO users never use the
 *  password-login flow, but the column is NOT NULL). */
export async function findOrCreateSsoUser(email: string): Promise<User> {
  const existing = await findUserByEmail(email);
  if (existing) return existing;
  const unusableHash = `sso:${randomUUID()}`;
  return createUser(email, unusableHash);
}

export async function findUserById(id: string): Promise<User | null> {
  const result = await pool.query(
    `SELECT id, email, "passwordHash", "createdAt" FROM "User" WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}
