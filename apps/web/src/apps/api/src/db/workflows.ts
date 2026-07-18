import { pool } from './pool';
import { randomUUID } from 'crypto';

export interface Workflow {
  id: string;
  userId: string;
  name: string;
  nodesJson: unknown;
  edgesJson: unknown;
  isActive: boolean;
  workspaceId: string | null;
  folderId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function createWorkflow(
  userId: string,
  name: string,
  nodesJson: unknown,
  edgesJson: unknown,
  workspaceId?: string | null,
  folderId?: string | null
): Promise<Workflow> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "Workflow" (id, "userId", name, "nodesJson", "edgesJson", "isActive", "workspaceId", "folderId", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, false, $6, $7, now())
     RETURNING *`,
    [id, userId, name, JSON.stringify(nodesJson), JSON.stringify(edgesJson), workspaceId ?? null, folderId ?? null]
  );
  return result.rows[0];
}

/** Workflows owned by the user directly, OR belonging to any workspace they're a member of. */
export async function listWorkflows(userId: string, workspaceId?: string): Promise<Workflow[]> {
  if (workspaceId) {
    const result = await pool.query(
      `SELECT wf.* FROM "Workflow" wf
       JOIN "WorkspaceMember" m ON m."workspaceId" = wf."workspaceId" AND m."userId" = $2
       WHERE wf."workspaceId" = $1 ORDER BY wf."createdAt" DESC`,
      [workspaceId, userId]
    );
    return result.rows;
  }
  const result = await pool.query(
    `SELECT DISTINCT wf.* FROM "Workflow" wf
     LEFT JOIN "WorkspaceMember" m ON m."workspaceId" = wf."workspaceId" AND m."userId" = $1
     WHERE wf."userId" = $1 OR m."userId" = $1
     ORDER BY wf."createdAt" DESC`,
    [userId]
  );
  return result.rows;
}

/** Fetches a workflow if the user owns it directly or belongs to its workspace (any role). */
export async function getWorkflowById(id: string, userId: string): Promise<Workflow | null> {
  const result = await pool.query(
    `SELECT wf.* FROM "Workflow" wf
     LEFT JOIN "WorkspaceMember" m ON m."workspaceId" = wf."workspaceId" AND m."userId" = $2
     WHERE wf.id = $1 AND (wf."userId" = $2 OR m."userId" = $2)`,
    [id, userId]
  );
  return result.rows[0] ?? null;
}

/** Fetches a workflow with no ownership/membership check — only use after a permission check (e.g. requireWorkflowRole) has already run. */
export async function getWorkflowByIdUnsafe(id: string): Promise<Workflow | null> {
  const result = await pool.query(`SELECT * FROM "Workflow" WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function updateWorkflow(
  id: string,
  userId: string,
  fields: Partial<Pick<Workflow, 'name' | 'nodesJson' | 'edgesJson' | 'isActive' | 'folderId'>>
): Promise<Workflow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (fields.name !== undefined) {
    sets.push(`name = $${idx++}`);
    values.push(fields.name);
  }
  if (fields.nodesJson !== undefined) {
    sets.push(`"nodesJson" = $${idx++}`);
    values.push(JSON.stringify(fields.nodesJson));
  }
  if (fields.edgesJson !== undefined) {
    sets.push(`"edgesJson" = $${idx++}`);
    values.push(JSON.stringify(fields.edgesJson));
  }
  if (fields.isActive !== undefined) {
    sets.push(`"isActive" = $${idx++}`);
    values.push(fields.isActive);
  }
  if (fields.folderId !== undefined) {
    sets.push(`"folderId" = $${idx++}`);
    values.push(fields.folderId);
  }
  sets.push(`"updatedAt" = now()`);

  if (sets.length === 1) {
    return getWorkflowById(id, userId);
  }

  // Access check: owner or any workspace member with this id may update (role gating
  // for *which* fields happens in the route layer via requireWorkflowRole).
  values.push(id, userId);
  const result = await pool.query(
    `UPDATE "Workflow" SET ${sets.join(', ')}
     WHERE id = $${idx++} AND (
       "userId" = $${idx} OR "workspaceId" IN (SELECT "workspaceId" FROM "WorkspaceMember" WHERE "userId" = $${idx})
     )
     RETURNING *`,
    values
  );
  return result.rows[0] ?? null;
}

export async function deleteWorkflow(id: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM "Workflow" WHERE id = $1 AND (
       "userId" = $2 OR "workspaceId" IN (SELECT "workspaceId" FROM "WorkspaceMember" WHERE "userId" = $2 AND role IN ('owner','admin'))
     )`,
    [id, userId]
  );
  return (result.rowCount ?? 0) > 0;
}
