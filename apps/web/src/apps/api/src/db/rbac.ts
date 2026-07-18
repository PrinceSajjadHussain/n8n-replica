import { pool } from './pool';

/** Instance-wide role, separate from per-workspace WorkspaceRole. */
export type SystemRole = 'superadmin' | 'admin' | 'member';

const RANK: Record<SystemRole, number> = { member: 0, admin: 1, superadmin: 2 };

export function systemRoleAtLeast(role: SystemRole | null | undefined, min: SystemRole): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[min];
}

export async function getSystemRole(userId: string): Promise<SystemRole | null> {
  const result = await pool.query(`SELECT "systemRole" FROM "User" WHERE id = $1`, [userId]);
  return result.rows[0]?.systemRole ?? null;
}

export async function setSystemRole(userId: string, role: SystemRole): Promise<void> {
  await pool.query(`UPDATE "User" SET "systemRole" = $2 WHERE id = $1`, [userId, role]);
}

export async function listUsersWithRoles(limit = 200) {
  const result = await pool.query(
    `SELECT id, email, "systemRole", "createdAt" FROM "User" ORDER BY "createdAt" ASC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

/** Bootstraps the very first user created on an instance as superadmin, so
 *  there's always someone who can configure SSO/RBAC/tokens. No-op once any
 *  superadmin exists. */
export async function bootstrapFirstSuperadmin(userId: string): Promise<void> {
  const existing = await pool.query(`SELECT 1 FROM "User" WHERE "systemRole" = 'superadmin' LIMIT 1`);
  if (existing.rowCount && existing.rowCount > 0) return;
  await setSystemRole(userId, 'superadmin');
}
