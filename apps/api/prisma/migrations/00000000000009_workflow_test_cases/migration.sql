-- Step 9: Testing & evaluation (Phase 9) — save sample trigger inputs +
-- expected outputs per workflow, and run the workflow against each case
-- via the "Run tests" action (see apps/api/src/routes/workflowTests.ts).
-- "scorer" also covers the lightweight AI evaluation mode for agent/RAG/
-- openai-heavy workflows (a "similarity" scorer for non-exact outputs).

CREATE TABLE "WorkflowTestCase" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "workflowId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "input" JSONB NOT NULL DEFAULT '{}',
  "expectedOutput" JSONB NOT NULL DEFAULT '{}',
  "scorer" TEXT NOT NULL DEFAULT 'jsonDiff',
  "passThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "WorkflowTestCase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkflowTestCase_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE
);
CREATE INDEX "WorkflowTestCase_workflowId_idx" ON "WorkflowTestCase"("workflowId");
