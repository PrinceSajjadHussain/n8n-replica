-- Workflow versioning: draft vs. published, rollback, and diff support.

CREATE TYPE "WorkflowVersionStatus" AS ENUM ('draft', 'published');

ALTER TABLE "Workflow"
  ADD COLUMN "publishedNodesJson" JSONB,
  ADD COLUMN "publishedEdgesJson" JSONB,
  ADD COLUMN "publishedVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "draftVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "WorkflowVersion" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "workflowId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "WorkflowVersionStatus" NOT NULL DEFAULT 'draft',
  "nodesJson" JSONB NOT NULL,
  "edgesJson" JSONB NOT NULL,
  "message" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "WorkflowVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkflowVersion_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "WorkflowVersion_workflowId_version_key" ON "WorkflowVersion"("workflowId", "version");
CREATE INDEX "WorkflowVersion_workflowId_idx" ON "WorkflowVersion"("workflowId");

-- Backfill: existing active workflows get an initial published version = 1,
-- inactive ones get an initial draft version = 1.
INSERT INTO "WorkflowVersion" ("id", "workflowId", "version", "status", "nodesJson", "edgesJson", "createdBy", "createdAt")
SELECT gen_random_uuid()::text, "id", 1,
       CASE WHEN "isActive" THEN 'published' ELSE 'draft' END::"WorkflowVersionStatus",
       "nodesJson", "edgesJson", "userId", "createdAt"
FROM "Workflow";

UPDATE "Workflow" SET
  "draftVersion" = 1,
  "publishedVersion" = CASE WHEN "isActive" THEN 1 ELSE 0 END,
  "publishedNodesJson" = CASE WHEN "isActive" THEN "nodesJson" ELSE NULL END,
  "publishedEdgesJson" = CASE WHEN "isActive" THEN "edgesJson" ELSE NULL END;
