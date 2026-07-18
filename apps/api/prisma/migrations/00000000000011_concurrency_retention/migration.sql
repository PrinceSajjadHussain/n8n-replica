-- Step 11: Phase 1 execution-engine hardening — per-workflow concurrency
-- limits (Make/n8n both cap how many runs of the same workflow can be
-- in-flight at once, to protect downstream APIs/DB connections from a burst
-- of triggers) and execution-history retention (nothing previously pruned
-- old Execution/ExecutionNodeRun rows, so the table grows unbounded).
--
-- Retention itself needs no schema change (it's driven by
-- EXECUTION_RETENTION_DAYS + a scheduled job — see
-- apps/worker/src/utils/retention.ts) but the timestamp index below makes
-- the periodic sweep's DELETE ... WHERE "startedAt" < $cutoff cheap instead
-- of a full table scan.

ALTER TABLE "Workflow" ADD COLUMN "maxConcurrency" INTEGER;

CREATE INDEX IF NOT EXISTS "Execution_startedAt_idx" ON "Execution"("startedAt");
