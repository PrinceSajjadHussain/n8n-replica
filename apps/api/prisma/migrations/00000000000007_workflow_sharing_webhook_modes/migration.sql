-- Phase 4 (n8n parity): workflow-level sharing/ownership transfer, and
-- webhook response modes (the webhook route itself needs no schema change —
-- responseMode lives in the webhook trigger node's existing JSON params —
-- this migration only adds workflow sharing).

-- Direct, per-user workflow shares — independent of workspace membership,
-- mirroring "CredentialShare". Role reuses the same rank as workspace
-- roles ('viewer' < 'editor' < 'admin'); 'owner' is not grantable here —
-- use POST /workflows/:id/transfer-ownership to change the real owner.
CREATE TABLE "WorkflowShare" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "workflowId" TEXT NOT NULL,
  "sharedWithUserId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'viewer',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "WorkflowShare_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkflowShare_role_check" CHECK ("role" IN ('viewer', 'editor', 'admin')),
  CONSTRAINT "WorkflowShare_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE,
  CONSTRAINT "WorkflowShare_sharedWithUserId_fkey" FOREIGN KEY ("sharedWithUserId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "WorkflowShare_workflowId_sharedWithUserId_key" ON "WorkflowShare"("workflowId", "sharedWithUserId");
CREATE INDEX "WorkflowShare_sharedWithUserId_idx" ON "WorkflowShare"("sharedWithUserId");
CREATE INDEX "WorkflowShare_workflowId_idx" ON "WorkflowShare"("workflowId");
