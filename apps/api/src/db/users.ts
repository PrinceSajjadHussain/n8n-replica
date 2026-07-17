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

export async function findUserById(id: string): Promise<User | null> {
  const result = await pool.query(
    `SELECT id, email, "passwordHash", "createdAt" FROM "User" WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}
