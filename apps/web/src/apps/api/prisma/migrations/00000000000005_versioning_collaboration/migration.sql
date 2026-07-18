-- Step 6: Versioning & collaboration
-- Workspaces/projects/folders, roles & permissions, sharing, comments,
-- activity log, and alerting/notifications on execution failure.
--
-- (Draft vs. published versions, rollback, and diff already exist as of
-- migration 00000000000003_workflow_versioning — this migration adds the
-- collaboration layer around them.)

CREATE TYPE "WorkspaceRole" AS ENUM ('owner', 'admin', 'editor', 'viewer');
CREATE TYPE "AlertChannel" AS ENUM ('email', 'webhook');

-- A workspace groups workflows, folders, and members together. Every user
-- gets a personal workspace on signup (backfilled below for existing users).
CREATE TABLE "Workspace" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Workspace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE TABLE "WorkspaceMember" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "WorkspaceRole" NOT NULL DEFAULT 'viewer',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE,
  CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- Folders live inside a workspace and can nest (parentId), for organizing
-- workflows into projects/sub-projects.
CREATE TABLE "WorkflowFolder" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "workspaceId" TEXT NOT NULL,
  "parentId" TEXT,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "WorkflowFolder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkflowFolder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE,
  CONSTRAINT "WorkflowFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WorkflowFolder"("id") ON DELETE SET NULL
);
CREATE INDEX "WorkflowFolder_workspaceId_idx" ON "WorkflowFolder"("workspaceId");

ALTER TABLE "Workflow"
  ADD COLUMN "workspaceId" TEXT,
  ADD COLUMN "folderId" TEXT;

ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL;
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "WorkflowFolder"("id") ON DELETE SET NULL;
CREATE INDEX "Workflow_workspaceId_idx" ON "Workflow"("workspaceId");
CREATE INDEX "Workflow_folderId_idx" ON "Workflow"("folderId");

-- Comments on a workflow, optionally pinned to a specific node (for
-- inline review discussions on the canvas).
CREATE TABLE "WorkflowComment" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "workflowId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "nodeId" TEXT,
  "body" TEXT NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "WorkflowComment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkflowComment_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE,
  CONSTRAINT "WorkflowComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX "WorkflowComment_workflowId_idx" ON "WorkflowComment"("workflowId");

-- Append-only activity feed. workspaceId and/or workflowId may be set
-- depending on the scope of the event.
CREATE TABLE "ActivityLog" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "workspaceId" TEXT,
  "workflowId" TEXT,
  "userId" TEXT,
  "action" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActivityLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE,
  CONSTRAINT "ActivityLog_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE,
  CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE INDEX "ActivityLog_workspaceId_idx" ON "ActivityLog"("workspaceId");
CREATE INDEX "ActivityLog_workflowId_idx" ON "ActivityLog"("workflowId");
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- Alert/notification configs: who to notify (email or webhook) when a
-- workflow execution finishes, on failure by default.
CREATE TABLE "AlertConfig" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "workflowId" TEXT NOT NULL,
  "channel" "AlertChannel" NOT NULL,
  "target" TEXT NOT NULL,
  "onFailure" BOOLEAN NOT NULL DEFAULT true,
  "onSuccess" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "AlertConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AlertConfig_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE
);
CREATE INDEX "AlertConfig_workflowId_idx" ON "AlertConfig"("workflowId");

-- Backfill: give every existing user a personal workspace ("owner" role)
-- and move all of their existing workflows into it.
INSERT INTO "Workspace" ("id", "name", "ownerId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, COALESCE(NULLIF(split_part("email", '@', 1), ''), 'My') || '''s Workspace', "id", now(), now()
FROM "User";

INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "createdAt")
SELECT gen_random_uuid()::text, w."id", w."ownerId", 'owner', now()
FROM "Workspace" w;

UPDATE "Workflow" wf SET "workspaceId" = w."id"
FROM "Workspace" w
WHERE w."ownerId" = wf."userId" AND wf."workspaceId" IS NULL;
