-- Step 8: Data persistence primitives (Phase 7) — a lightweight built-in
-- "Data Table" per workspace (Make's Data Store / n8n's Data Tables
-- equivalent), plus a workflow-level static-data JSON blob for
-- $getWorkflowStaticData()-style lightweight state.

-- Column definitions live as JSONB (array of {name, type}) rather than
-- real Postgres columns, since the set of columns is user-defined and
-- changes over time — rows are free-form JSONB validated loosely against
-- this schema by the API, not enforced at the DB level.
CREATE TABLE "DataTable" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "columns" JSONB NOT NULL DEFAULT '[]',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "DataTable_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataTable_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "DataTable_workspace_name_key" ON "DataTable"("workspaceId", "name");
CREATE INDEX "DataTable_workspaceId_idx" ON "DataTable"("workspaceId");

CREATE TABLE "DataTableRow" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "dataTableId" TEXT NOT NULL,
  "data" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "DataTableRow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataTableRow_dataTableId_fkey" FOREIGN KEY ("dataTableId") REFERENCES "DataTable"("id") ON DELETE CASCADE
);
CREATE INDEX "DataTableRow_dataTableId_idx" ON "DataTableRow"("dataTableId");
-- Supports the Data Table node's filterColumn/matchColumn lookups
-- (WHERE data->>'col' = 'val') without a full table scan.
CREATE INDEX "DataTableRow_data_gin_idx" ON "DataTableRow" USING GIN ("data");

-- Workflow static data: small persisted JSON blob, read/written from the
-- Code node ($getWorkflowStaticData/$setWorkflowStaticData) and readable
-- from any node's params as {{$staticData.KEY}}.
ALTER TABLE "Workflow" ADD COLUMN "staticData" JSONB NOT NULL DEFAULT '{}';
