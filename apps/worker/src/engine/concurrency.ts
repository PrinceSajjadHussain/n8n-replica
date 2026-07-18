import IORedis from 'ioredis';

/**
 * Per-workflow concurrency limiting.
 *
 * `WORKER_CONCURRENCY` already caps how many jobs this worker PROCESS runs
 * at once, but that's a global cap — it does nothing to stop 50 queued
 * executions of the SAME workflow from all running simultaneously and
 * hammering whatever API/DB it calls. `Workflow.maxConcurrency` (nullable —
 * unset means unlimited) fixes that with a small Redis-backed slot count,
 * shared across every worker process/instance so the limit holds even when
 * horizontally scaled.
 *
 * Implementation: a Redis key `ff:concurrency:<workflowId>` holds the count
 * of in-flight executions for that workflow. `acquireSlot` atomically
 * increments only if under the limit (Lua script — avoids a
 * read-then-write race between workers); `releaseSlot` decrements. Slots
 * also carry a safety TTL so a worker crash mid-execution can't leak a slot
 * forever and permanently wedge the workflow.
 */

const SLOT_TTL_SECONDS = 60 * 60; // 1h safety net for crashed workers

const ACQUIRE_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local current = tonumber(redis.call('GET', key) or '0')
if current >= limit then
  return 0
end
local next = redis.call('INCR', key)
redis.call('EXPIRE', key, ttl)
return next
`;

let sharedConnection: IORedis | null = null;

function getConnection(): IORedis {
  if (!sharedConnection) {
    sharedConnection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
  }
  return sharedConnection;
}

function slotKey(workflowId: string): string {
  return `ff:concurrency:${workflowId}`;
}

/**
 * Attempts to reserve one of `maxConcurrency` concurrent-execution slots for
 * this workflow. Returns true if the slot was granted (caller must call
 * `releaseSlot` when the execution finishes, success or failure), false if
 * the workflow is already at its limit and the job should be retried later.
 *
 * `maxConcurrency` of null/undefined/<=0 means unlimited — always grants.
 */
export async function acquireSlot(workflowId: string, maxConcurrency: number | null | undefined): Promise<boolean> {
  if (!maxConcurrency || maxConcurrency <= 0) return true;
  const redis = getConnection();
  const result = await redis.eval(ACQUIRE_SCRIPT, 1, slotKey(workflowId), maxConcurrency, SLOT_TTL_SECONDS);
  return Number(result) > 0;
}

/** Releases a previously-acquired slot. Safe to call even if none was held (no-op floor at 0). */
export async function releaseSlot(workflowId: string, maxConcurrency: number | null | undefined): Promise<void> {
  if (!maxConcurrency || maxConcurrency <= 0) return;
  const redis = getConnection();
  const key = slotKey(workflowId);
  const next = await redis.decr(key);
  if (next <= 0) {
    // Clean up the key entirely rather than leaving a 0 (or negative, from
    // a race) counter sitting around forever.
    await redis.del(key);
  }
}
