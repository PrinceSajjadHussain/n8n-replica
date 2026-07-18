import { pool } from '../db/pool';

/**
 * Execution-history retention.
 *
 * Nothing previously deleted old `Execution` rows (or their
 * `ExecutionNodeRun` children, which cascade-delete with them) — every run
 * of every workflow, forever, including full node-level input/output JSON
 * for each step. That's unbounded growth and, since inputs/outputs can
 * contain PII/secrets flowing through a workflow, an unnecessary long-lived
 * copy of sensitive data sitting in the DB well past when anyone needs it.
 *
 * `EXECUTION_RETENTION_DAYS` (unset or `0` = disabled, keep forever) sets
 * how many days of history to keep. A lightweight in-process interval
 * sweeps expired rows — no new infra dependency, and safe to run from every
 * worker instance concurrently since the DELETE is naturally idempotent
 * (each sweep just deletes whatever's still older than the cutoff).
 *
 * For very large tables, replace the interval with a `pg_cron` job or an
 * external scheduled task calling `pruneOldExecutions` directly — the
 * function is exported standalone for that.
 */

const DEFAULT_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly
const DEFAULT_BATCH_SIZE = 500; // rows per DELETE, to avoid one huge lock on large tables

export interface PruneResult {
  deletedExecutions: number;
  cutoff: Date;
}

/**
 * Deletes `Execution` rows (and their cascaded `ExecutionNodeRun` children)
 * with `startedAt` older than `retentionDays` ago. Runs in batches so a
 * years-old backlog doesn't take out a single giant transaction/lock.
 * Currently-`running`/`paused` executions are never pruned regardless of
 * age — only rows in a terminal status (`success`, `failed`) are eligible,
 * so a long-paused human-approval step can't be silently deleted out from
 * under someone.
 */
export async function pruneOldExecutions(
  retentionDays: number,
  batchSize: number = DEFAULT_BATCH_SIZE
): Promise<PruneResult> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  let deletedExecutions = 0;

  for (;;) {
    const result = await pool.query(
      `DELETE FROM "Execution"
       WHERE id IN (
         SELECT id FROM "Execution"
         WHERE "startedAt" < $1
           AND status IN ('success', 'failed')
         LIMIT $2
       )`,
      [cutoff, batchSize]
    );
    const count = result.rowCount ?? 0;
    deletedExecutions += count;
    if (count < batchSize) break; // fewer than a full batch = nothing left to page through
  }

  return { deletedExecutions, cutoff };
}

let sweeperHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the periodic sweep if `EXECUTION_RETENTION_DAYS` is set to a
 * positive number. No-op (logs once, does nothing further) if unset/0 —
 * retention is opt-in so existing deployments keep today's "keep
 * everything forever" behavior unless an operator explicitly configures a
 * window. Idempotent: calling this more than once is safe, it clears any
 * previous interval first.
 */
export function startRetentionSweeper(
  intervalMs: number = Number(process.env.EXECUTION_RETENTION_SWEEP_INTERVAL_MS ?? DEFAULT_SWEEP_INTERVAL_MS)
): void {
  const retentionDays = Number(process.env.EXECUTION_RETENTION_DAYS ?? 0);
  if (sweeperHandle) {
    clearInterval(sweeperHandle);
    sweeperHandle = null;
  }
  if (!retentionDays || retentionDays <= 0) {
    console.log('[retention] EXECUTION_RETENTION_DAYS not set — execution history retention disabled, keeping all rows.');
    return;
  }

  const sweep = () => {
    pruneOldExecutions(retentionDays)
      .then(({ deletedExecutions, cutoff }) => {
        if (deletedExecutions > 0) {
          console.log(`[retention] pruned ${deletedExecutions} execution(s) older than ${cutoff.toISOString()} (retention: ${retentionDays}d)`);
        }
      })
      .catch((err) => console.error('[retention] sweep failed:', err));
  };

  // Run once shortly after startup (small delay so it doesn't compete with
  // initial job pickup), then on the configured interval.
  setTimeout(sweep, 10_000);
  sweeperHandle = setInterval(sweep, intervalMs);
}
