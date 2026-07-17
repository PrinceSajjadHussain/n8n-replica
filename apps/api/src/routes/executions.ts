import { Router } from 'express';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';

export const executionsRouter = Router();
executionsRouter.use(requireAuth);

executionsRouter.get('/:id', async (req: AuthedRequest, res) => {
  // Join through Workflow to enforce ownership.
  const execResult = await pool.query(
    `SELECT e.* FROM "Execution" e
     JOIN "Workflow" w ON w.id = e."workflowId"
     WHERE e.id = $1 AND w."userId" = $2`,
    [req.params.id, req.userId!]
  );
  const execution = execResult.rows[0];
  if (!execution) return res.status(404).json({ error: 'Execution not found' });

  const nodeRuns = await pool.query(
    `SELECT * FROM "ExecutionNodeRun" WHERE "executionId" = $1 ORDER BY "startedAt" NULLS LAST`,
    [execution.id]
  );

  res.json({ execution, nodeRuns: nodeRuns.rows });
});
