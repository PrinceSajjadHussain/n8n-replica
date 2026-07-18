import { pool } from './pool';
import { randomUUID } from 'crypto';

export interface Variable {
  id: string;
  workspaceId: string | null;
  key: string;
  value: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Global (workspaceId null) variables plus any scoped to the given workspace — global entries first, then workspace-specific ones. */
export async function listVariables(workspaceId?: string | null): Promise<Variable[]> {
  if (workspaceId) {
    const result = await pool.query(
      `SELECT * FROM "Variable" WHERE "workspaceId" IS NULL OR "workspaceId" = $1 ORDER BY "workspaceId" NULLS FIRST, "key" ASC`,
      [workspaceId]
    );
    return result.rows;
  }
  const result = await pool.query(`SELECT * FROM "Variable" WHERE "workspaceId" IS NULL ORDER BY "key" ASC`);
  return result.rows;
}

export async function createVariable(
  createdBy: string,
  key: string,
  value: string,
  workspaceId?: string | null
): Promise<Variable> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "Variable" (id, "workspaceId", key, value, "createdBy", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, now())
     RETURNING *`,
    [id, workspaceId ?? null, key, value, createdBy]
  );
  return result.rows[0];
}

export async function updateVariable(
  id: string,
  fields: { key?: string; value?: string }
): Promise<Variable | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (fields.key !== undefined) {
    sets.push(`key = $${idx++}`);
    values.push(fields.key);
  }
  if (fields.value !== undefined) {
    sets.push(`value = $${idx++}`);
    values.push(fields.value);
  }
  if (sets.length === 0) {
    const result = await pool.query(`SELECT * FROM "Variable" WHERE id = $1`, [id]);
    return result.rows[0] ?? null;
  }
  sets.push(`"updatedAt" = now()`);
  values.push(id);
  const result = await pool.query(
    `UPDATE "Variable" SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] ?? null;
}

export async function deleteVariable(id: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM "Variable" WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

/** All variables visible to a given workflow, as a flat key->value map (workspace-scoped values win over a global var of the same key). Used by the worker to build the `$vars` expression context. */
export async function getVariablesMapForWorkflow(workflowId: string): Promise<Record<string, string>> {
  const result = await pool.query(
    `SELECT v.key, v.value, v."workspaceId"
     FROM "Variable" v
     WHERE v."workspaceId" IS NULL
        OR v."workspaceId" = (SELECT "workspaceId" FROM "Workflow" WHERE id = $1)
     ORDER BY v."workspaceId" NULLS FIRST`,
    [workflowId]
  );
  const map: Record<string, string> = {};
  for (const row of result.rows as { key: string; value: string }[]) {
    map[row.key] = row.value; // workspace-scoped rows come after global ones, so they overwrite
  }
  return map;
}
