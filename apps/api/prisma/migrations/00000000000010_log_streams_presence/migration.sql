-- Step 10: Operations & collaboration polish (Phase 10) — workspace-wide
-- execution log streaming (org owner/admin settings -> external webhook,
-- e.g. Datadog/Sentry/Slack), on top of the existing per-workflow
-- finish-only AlertConfig.

CREATE TABLE "LogStreamConfig" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "targetUrl" TEXT NOT NULL,
  "eventTypes" JSONB NOT NULL DEFAULT '["started", "completed", "failed"]',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "headers" JSONB,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "LogStreamConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LogStreamConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE
);
CREATE INDEX "LogStreamConfig_workspaceId_idx" ON "LogStreamConfig"("workspaceId");
