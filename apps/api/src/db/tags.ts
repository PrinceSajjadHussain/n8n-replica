import { pool } from './pool';
import { randomUUID } from 'crypto';

export interface Tag {
  id: string;
  workspaceId: string | null;
  name: string;
  createdAt: Date;
}

/** Global tags plus any scoped to the given workspace. */
export async function listTags(workspaceId?: string | null): Promise<Tag[]> {
  if (workspaceId) {
    const result = await pool.query(
      `SELECT * FROM "Tag" WHERE "workspaceId" IS NULL OR "workspaceId" = $1 ORDER BY name ASC`,
      [workspaceId]
    );
    return result.rows;
  }
  const result = await pool.query(`SELECT * FROM "Tag" WHERE "workspaceId" IS NULL ORDER BY name ASC`);
  return result.rows;
}

export async function createTag(name: string, workspaceId?: string | null): Promise<Tag> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "Tag" (id, "workspaceId", name) VALUES ($1, $2, $3) RETURNING *`,
    [id, workspaceId ?? null, name]
  );
  return result.rows[0];
}

export async function deleteTag(id: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM "Tag" WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function getTagsForWorkflow(workflowId: string): Promise<Tag[]> {
  const result = await pool.query(
    `SELECT t.* FROM "Tag" t
     JOIN "WorkflowTag" wt ON wt."tagId" = t.id
     WHERE wt."workflowId" = $1
     ORDER BY t.name ASC`,
    [workflowId]
  );
  return result.rows;
}

/** Replaces a workflow's full tag set with the given tag ids (removes any not listed, adds any missing). */
export async function setWorkflowTags(workflowId: string, tagIds: string[]): Promise<void> {
  await pool.query(`DELETE FROM "WorkflowTag" WHERE "workflowId" = $1`, [workflowId]);
  if (tagIds.length === 0) return;
  const values = tagIds.map((_, i) => `($1, $${i + 2})`).join(', ');
  await pool.query(`INSERT INTO "WorkflowTag" ("workflowId", "tagId") VALUES ${values}`, [workflowId, ...tagIds]);
}

/** Workflow ids tagged with the given tag id, for GET /workflows?tag= filtering. */
export async function listWorkflowIdsForTag(tagId: string): Promise<string[]> {
  const result = await pool.query(`SELECT "workflowId" FROM "WorkflowTag" WHERE "tagId" = $1`, [tagId]);
  return result.rows.map((r: { workflowId: string }) => r.workflowId);
}
