import { pool } from './pool';
import { randomUUID } from 'crypto';

export interface Subscription {
  id: string;
  workspaceId: string;
  plan: string;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UsageCounter {
  id: string;
  workspaceId: string;
  period: string;
  executionCount: number;
  updatedAt: Date;
}

export type PlanId = 'free' | 'pro' | 'business';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  monthlyExecutionLimit: number | null; // null = unlimited
  priceUsd: number;
  stripePriceId?: string;
  features: string[];
}

/** Static plan catalog. Prices/limits are illustrative — real numbers and
 *  Stripe price IDs belong in env config once this goes to production. */
export const PLANS: PlanDefinition[] = [
  {
    id: 'free',
    name: 'Free',
    monthlyExecutionLimit: 500,
    priceUsd: 0,
    features: ['500 executions / month', '1 workspace', 'Community support'],
  },
  {
    id: 'pro',
    name: 'Pro',
    monthlyExecutionLimit: 20000,
    priceUsd: 29,
    stripePriceId: process.env.STRIPE_PRICE_PRO,
    features: ['20,000 executions / month', 'Unlimited workspaces', 'Priority support', 'Audit log'],
  },
  {
    id: 'business',
    name: 'Business',
    monthlyExecutionLimit: null,
    priceUsd: 99,
    stripePriceId: process.env.STRIPE_PRICE_BUSINESS,
    features: ['Unlimited executions', 'SSO', 'Dedicated support', 'Custom retention'],
  },
];

export function getPlan(planId: string): PlanDefinition {
  return PLANS.find((p) => p.id === planId) ?? PLANS[0];
}

/** The current UTC calendar-month period key, e.g. "2026-07". */
export function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function getSubscription(workspaceId: string): Promise<Subscription | null> {
  const result = await pool.query(`SELECT * FROM "Subscription" WHERE "workspaceId" = $1`, [workspaceId]);
  return result.rows[0] ?? null;
}

/** Ensures a workspace has a Subscription row, defaulting to the free plan — called lazily so existing workspaces don't need a backfill migration. */
export async function ensureSubscription(workspaceId: string): Promise<Subscription> {
  const existing = await getSubscription(workspaceId);
  if (existing) return existing;
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "Subscription" (id, "workspaceId", plan, status, "createdAt", "updatedAt")
     VALUES ($1, $2, 'free', 'active', now(), now())
     ON CONFLICT ("workspaceId") DO UPDATE SET "updatedAt" = now()
     RETURNING *`,
    [id, workspaceId]
  );
  return result.rows[0];
}

export async function upsertSubscriptionFromStripe(
  workspaceId: string,
  fields: {
    plan?: string;
    status?: string;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    currentPeriodEnd?: Date | null;
    cancelAtPeriodEnd?: boolean;
  }
): Promise<Subscription> {
  await ensureSubscription(workspaceId);
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const [key, value] of Object.entries(fields)) {
    sets.push(`"${key}" = $${idx++}`);
    values.push(value);
  }
  sets.push(`"updatedAt" = now()`);
  values.push(workspaceId);
  const result = await pool.query(
    `UPDATE "Subscription" SET ${sets.join(', ')} WHERE "workspaceId" = $${idx} RETURNING *`,
    values
  );
  return result.rows[0];
}

export async function findSubscriptionByStripeCustomerId(stripeCustomerId: string): Promise<Subscription | null> {
  const result = await pool.query(`SELECT * FROM "Subscription" WHERE "stripeCustomerId" = $1`, [stripeCustomerId]);
  return result.rows[0] ?? null;
}

export async function findSubscriptionByStripeSubscriptionId(stripeSubscriptionId: string): Promise<Subscription | null> {
  const result = await pool.query(`SELECT * FROM "Subscription" WHERE "stripeSubscriptionId" = $1`, [stripeSubscriptionId]);
  return result.rows[0] ?? null;
}

/** Atomically increments this month's execution counter for a workspace and
 *  returns the new total — used both for metering and for cheap plan-limit
 *  checks before enqueueing a run. */
export async function incrementUsage(workspaceId: string): Promise<number> {
  const period = currentPeriod();
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "UsageCounter" (id, "workspaceId", period, "executionCount", "updatedAt")
     VALUES ($1, $2, $3, 1, now())
     ON CONFLICT ("workspaceId", period)
     DO UPDATE SET "executionCount" = "UsageCounter"."executionCount" + 1, "updatedAt" = now()
     RETURNING "executionCount"`,
    [id, workspaceId, period]
  );
  return result.rows[0].executionCount;
}

export async function getUsage(workspaceId: string, period: string = currentPeriod()): Promise<UsageCounter | null> {
  const result = await pool.query(`SELECT * FROM "UsageCounter" WHERE "workspaceId" = $1 AND period = $2`, [
    workspaceId,
    period,
  ]);
  return result.rows[0] ?? null;
}

export async function getUsageHistory(workspaceId: string, months = 6): Promise<UsageCounter[]> {
  const result = await pool.query(
    `SELECT * FROM "UsageCounter" WHERE "workspaceId" = $1 ORDER BY period DESC LIMIT $2`,
    [workspaceId, months]
  );
  return result.rows;
}

/** Checks whether a workspace is within its plan's monthly execution limit.
 *  Used as a soft gate before enqueueing — free/pro plans get blocked once
 *  over quota, business (unlimited) never is. */
export async function isWithinUsageLimit(workspaceId: string): Promise<{ ok: boolean; used: number; limit: number | null }> {
  const sub = await ensureSubscription(workspaceId);
  const plan = getPlan(sub.plan);
  if (plan.monthlyExecutionLimit === null) return { ok: true, used: 0, limit: null };
  const usage = await getUsage(workspaceId);
  const used = usage?.executionCount ?? 0;
  return { ok: used < plan.monthlyExecutionLimit, used, limit: plan.monthlyExecutionLimit };
}
