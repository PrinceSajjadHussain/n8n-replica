-- Step 12: Platform billing + usage metering (Phase 6 polish).
--
-- This is deliberately separate from the existing `stripe` workflow *node*
-- (apps/worker/src/nodes/stripe.ts), which lets a workflow call the Stripe
-- API as an action. This migration is about billing FlowForge itself: one
-- Subscription per workspace (the unit customers actually pay for), plus a
-- lightweight per-workspace-per-period execution counter so a free/starter
-- plan can be capped without querying the full Execution history table on
-- every run.

CREATE TABLE "Subscription" (
  "id"                   TEXT PRIMARY KEY,
  "workspaceId"          TEXT NOT NULL UNIQUE REFERENCES "Workspace"("id") ON DELETE CASCADE,
  "plan"                 TEXT NOT NULL DEFAULT 'free',
  "status"                TEXT NOT NULL DEFAULT 'active',
  "stripeCustomerId"     TEXT,
  "stripeSubscriptionId" TEXT UNIQUE,
  "currentPeriodEnd"     TIMESTAMP(3),
  "cancelAtPeriodEnd"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE INDEX "Subscription_workspaceId_idx" ON "Subscription"("workspaceId");
CREATE INDEX "Subscription_stripeCustomerId_idx" ON "Subscription"("stripeCustomerId");

-- One row per workspace per calendar-month billing period ("2026-07"),
-- incremented atomically each time an execution is enqueued. Cheap to read
-- for plan-limit checks and for the usage bar in BillingPage.tsx.
CREATE TABLE "UsageCounter" (
  "id"              TEXT PRIMARY KEY,
  "workspaceId"     TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
  "period"          TEXT NOT NULL,
  "executionCount"  INTEGER NOT NULL DEFAULT 0,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "UsageCounter_workspaceId_period_key" ON "UsageCounter"("workspaceId", "period");
