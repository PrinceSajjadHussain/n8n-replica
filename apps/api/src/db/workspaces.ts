import { pool } from './pool';
import { randomUUID } from 'crypto';

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';

const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

/** True if `role` grants at least `minRole` privileges. */
export function roleAtLeast(role: WorkspaceRole | null | undefined, minRole: WorkspaceRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Creates a workspace and adds the creator as its owner member. */
export async function createWorkspace(userId: string, name: string): Promise<Workspace> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "Workspace" (id, name, "ownerId", "updatedAt") VALUES ($1, $2, $3, now()) RETURNING *`,
    [id, name, userId]
  );
  await pool.query(
    `INSERT INTO "WorkspaceMember" (id, "workspaceId", "userId", role) VALUES ($1, $2, $3, 'owner')`,
    [randomUUID(), id, userId]
  );
  return result.rows[0];
}

/** All workspaces a user belongs to, with their role in each. */
export async function listWorkspacesForUser(
  userId: string
): Promise<Array<Workspace & { role: WorkspaceRole }>> {
  const result = await pool.query(
    `SELECT w.*, m.role FROM "Workspace" w
     JOIN "WorkspaceMember" m ON m."workspaceId" = w.id
     WHERE m."userId" = $1 ORDER BY w."createdAt" ASC`,
    [userId]
  );
  return result.rows;
}

export async function getWorkspaceRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  const result = await pool.query(
    `SELECT role FROM "WorkspaceMember" WHERE "workspaceId" = $1 AND "userId" = $2`,
    [workspaceId, userId]
  );
  return result.rows[0]?.role ?? null;
}

export async function getWorkspaceById(workspaceId: string): Promise<Workspace | null> {
  const result = await pool.query(`SELECT * FROM "Workspace" WHERE id = $1`, [workspaceId]);
  return result.rows[0] ?? null;
}

export async function renameWorkspace(workspaceId: string, name: string): Promise<Workspace | null> {
  const result = await pool.query(
    `UPDATE "Workspace" SET name = $2, "updatedAt" = now() WHERE id = $1 RETURNING *`,
    [workspaceId, name]
  );
  return result.rows[0] ?? null;
}

export interface WorkspaceMemberRow {
  id: string;
  workspaceId: string;
  userId: string;
  email: string;
  role: WorkspaceRole;
  createdAt: Date;
}

export async function listMembers(workspaceId: string): Promise<WorkspaceMemberRow[]> {
  const result = await pool.query(
    `SELECT m.id, m."workspaceId", m."userId", u.email, m.role, m."createdAt"
     FROM "WorkspaceMember" m JOIN "User" u ON u.id = m."userId"
     WHERE m."workspaceId" = $1 ORDER BY m."createdAt" ASC`,
    [workspaceId]
  );
  return result.rows;
}

export async function addMember(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole
): Promise<WorkspaceMemberRow> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "WorkspaceMember" (id, "workspaceId", "userId", role) VALUES ($1, $2, $3, $4)
     ON CONFLICT ("workspaceId", "userId") DO UPDATE SET role = EXCLUDED.role
     RETURNING id, "workspaceId", "userId", role, "createdAt"`,
    [id, workspaceId, userId, role]
  );
  const memberRow = result.rows[0];
  const userRow = await pool.query(`SELECT email FROM "User" WHERE id = $1`, [userId]);
  return { ...memberRow, email: userRow.rows[0]?.email ?? '' };
}

export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE "WorkspaceMember" SET role = $3 WHERE "workspaceId" = $1 AND "userId" = $2`,
    [workspaceId, userId, role]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function removeMember(workspaceId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM "WorkspaceMember" WHERE "workspaceId" = $1 AND "userId" = $2`,
    [workspaceId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

/** The role a user has on a workflow, derived from workspace membership (or 'owner' via the legacy userId column). */
export async function getWorkflowRole(workflowId: string, userId: string): Promise<WorkspaceRole | null> {
  const result = await pool.query(
    `SELECT wf."userId" AS "legacyOwnerId", m.role
     FROM "Workflow" wf
     LEFT JOIN "WorkspaceMember" m ON m."workspaceId" = wf."workspaceId" AND m."userId" = $2
     WHERE wf.id = $1`,
    [workflowId, userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.legacyOwnerId === userId) return 'owner';
  return row.role ?? null;
}

// --- Folders ---

export interface WorkflowFolder {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  createdAt: Date;
}

export async function createFolder(workspaceId: string, name: string, parentId?: string | null): Promise<WorkflowFolder> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "WorkflowFolder" (id, "workspaceId", "parentId", name) VALUES ($1, $2, $3, $4) RETURNING *`,
    [id, workspaceId, parentId ?? null, name]
  );
  return result.rows[0];
}

export async function listFolders(workspaceId: string): Promise<WorkflowFolder[]> {
  const result = await pool.query(
    `SELECT * FROM "WorkflowFolder" WHERE "workspaceId" = $1 ORDER BY "createdAt" ASC`,
    [workspaceId]
  );
  return result.rows;
}

export async function renameFolder(folderId: string, name: string): Promise<WorkflowFolder | null> {
  const result = await pool.query(`UPDATE "WorkflowFolder" SET name = $2 WHERE id = $1 RETURNING *`, [folderId, name]);
  return result.rows[0] ?? null;
}

export async function deleteFolder(folderId: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM "WorkflowFolder" WHERE id = $1`, [folderId]);
  return (result.rowCount ?? 0) > 0;
}

export async function getFolderWorkspace(folderId: string): Promise<string | null> {
  const result = await pool.query(`SELECT "workspaceId" FROM "WorkflowFolder" WHERE id = $1`, [folderId]);
  return result.rows[0]?.workspaceId ?? null;
}
