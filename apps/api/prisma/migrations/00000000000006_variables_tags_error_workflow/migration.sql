-- Step 7: Core n8n primitives — environment Variables ($vars), workflow
-- Tags, designated Error Workflow, and persisted manual-trigger test payload.

-- Global/workspace-scoped key-value store, referenced in expressions as
-- {{$vars.KEY}}. A NULL workspaceId is an instance-wide variable available
-- to every workflow; a non-null workspaceId scopes it to that workspace.
CREATE TABLE "Variable" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "workspaceId" TEXT,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "Variable_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Variable_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE
);
-- Partial unique indexes: one because Postgres treats NULL as distinct in
-- a plain unique index, and instance-wide keys still need one-per-key.
CREATE UNIQUE INDEX "Variable_workspace_key_key" ON "Variable"("workspaceId", "key") WHERE "workspaceId" IS NOT NULL;
CREATE UNIQUE INDEX "Variable_global_key_key" ON "Variable"("key") WHERE "workspaceId" IS NULL;
CREATE INDEX "Variable_workspaceId_idx" ON "Variable"("workspaceId");

-- Tags: simple named labels, scoped to a workspace, many-to-many with
-- workflows via the join table below (mirrors n8n's tag filtering in the
-- workflow list).
CREATE TABLE "Tag" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "workspaceId" TEXT,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "Tag_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Tag_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "Tag_workspace_name_key" ON "Tag"("workspaceId", "name") WHERE "workspaceId" IS NOT NULL;
CREATE UNIQUE INDEX "Tag_global_name_key" ON "Tag"("name") WHERE "workspaceId" IS NULL;
CREATE INDEX "Tag_workspaceId_idx" ON "Tag"("workspaceId");

CREATE TABLE "WorkflowTag" (
  "workflowId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  CONSTRAINT "WorkflowTag_pkey" PRIMARY KEY ("workflowId", "tagId"),
  CONSTRAINT "WorkflowTag_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE,
  CONSTRAINT "WorkflowTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE
);
CREATE INDEX "WorkflowTag_tagId_idx" ON "WorkflowTag"("tagId");

-- Error Workflow: a workflow to auto-run (with { failedWorkflowId,
-- executionId, errorMessage, nodeId } as its trigger payload) whenever
-- THIS workflow's execution fails. NULL = no error workflow configured.
ALTER TABLE "Workflow" ADD COLUMN "errorWorkflowId" TEXT;
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_errorWorkflowId_fkey"
  FOREIGN KEY ("errorWorkflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL;
CREATE INDEX "Workflow_errorWorkflowId_idx" ON "Workflow"("errorWorkflowId");

-- Manual trigger test payload: the last JSON body used to manually run this
-- workflow, persisted per-workflow like n8n's canvas "test workflow" panel,
-- so re-opening the editor doesn't lose it.
ALTER TABLE "Workflow" ADD COLUMN "lastManualTestPayload" JSONB;
