-- Support pause/resume workflows (Wait for Webhook, Human Approval nodes)
-- and execution checkpoints (resumable across worker restarts, since the
-- checkpoint lives in Postgres, not in worker process memory).

ALTER TYPE "ExecutionStatus" ADD VALUE IF NOT EXISTS 'paused';

ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "checkpoint" JSONB;
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "resumeToken" TEXT;
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "resumeNodeId" TEXT;
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Execution_resumeToken_key" ON "Execution"("resumeToken");
