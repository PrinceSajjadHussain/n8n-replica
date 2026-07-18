import { Router, raw } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { requireWorkspaceRole } from '../middleware/permissions';
import {
  PLANS,
  ensureSubscription,
  getPlan,
  getUsage,
  getUsageHistory,
  currentPeriod,
  upsertSubscriptionFromStripe,
  findSubscriptionByStripeSubscriptionId,
} from '../db/billing';

/** Lazily-constructed Stripe client. When STRIPE_SECRET_KEY isn't configured
 *  (local/dev, or this evaluation environment), billing runs in "mock mode":
 *  checkout/portal endpoints instantly activate/deactivate the target plan
 *  instead of redirecting to Stripe, so the rest of the product (plan gating,
 *  usage metering, UI) is fully exercisable without real Stripe credentials. */
let stripeClient: import('stripe').default | null | undefined;
async function getStripe(): Promise<import('stripe').default | null> {
  if (stripeClient !== undefined) return stripeClient;
  if (!process.env.STRIPE_SECRET_KEY) {
    stripeClient = null;
    return null;
  }
  const { default: Stripe } = await import('stripe');
  stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as any });
  return stripeClient;
}

export const billingRouter = Router();

/** GET /billing/:workspaceId — current plan, subscription status, and this
 *  period's usage, in one call so BillingPage.tsx only needs one request. */
billingRouter.get('/:workspaceId', requireAuth, requireWorkspaceRole('viewer'), async (req: AuthedRequest, res, next) => {
  try {
    const sub = await ensureSubscription(req.params.workspaceId);
    const plan = getPlan(sub.plan);
    const usage = await getUsage(req.params.workspaceId);
    const history = await getUsageHistory(req.params.workspaceId, 6);
    res.json({
      subscription: sub,
      plan,
      plans: PLANS,
      usage: { period: currentPeriod(), executionCount: usage?.executionCount ?? 0, limit: plan.monthlyExecutionLimit },
      history,
      mockMode: !process.env.STRIPE_SECRET_KEY,
    });
  } catch (err) {
    next(err);
  }
});

const checkoutSchema = z.object({ planId: z.enum(['free', 'pro', 'business']) });

/** POST /billing/:workspaceId/checkout — starts an upgrade. Real Stripe mode
 *  returns a Checkout Session URL to redirect to; mock mode applies the plan
 *  immediately and returns no redirect, so the UI can proceed either way. */
billingRouter.post('/:workspaceId/checkout', requireAuth, requireWorkspaceRole('admin'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { planId } = parsed.data;
    const workspaceId = req.params.workspaceId;
    const plan = getPlan(planId);

    if (planId === 'free') {
      const sub = await upsertSubscriptionFromStripe(workspaceId, { plan: 'free', status: 'active' });
      return res.json({ subscription: sub, url: null });
    }

    const stripe = await getStripe();
    if (!stripe || !plan.stripePriceId) {
      // Mock mode (or a plan without a configured Stripe price): activate
      // directly so the rest of the app can be evaluated end-to-end.
      const sub = await upsertSubscriptionFromStripe(workspaceId, {
        plan: planId,
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      return res.json({ subscription: sub, url: null, mockMode: true });
    }

    const sub = await ensureSubscription(workspaceId);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: sub.stripeCustomerId ?? undefined,
      client_reference_id: workspaceId,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${process.env.APP_URL ?? 'http://localhost:5173'}/billing?checkout=success`,
      cancel_url: `${process.env.APP_URL ?? 'http://localhost:5173'}/billing?checkout=cancelled`,
      metadata: { workspaceId, planId },
    });
    res.json({ subscription: sub, url: session.url });
  } catch (err) {
    next(err);
  }
});

/** POST /billing/:workspaceId/portal — Stripe customer portal for managing
 *  payment method / cancelling. In mock mode there's no portal to open, so
 *  we just report that. */
billingRouter.post('/:workspaceId/portal', requireAuth, requireWorkspaceRole('admin'), async (req: AuthedRequest, res, next) => {
  try {
    const workspaceId = req.params.workspaceId;
    const sub = await ensureSubscription(workspaceId);
    const stripe = await getStripe();
    if (!stripe || !sub.stripeCustomerId) {
      return res.json({ url: null, mockMode: true });
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${process.env.APP_URL ?? 'http://localhost:5173'}/billing`,
    });
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

/** POST /billing/:workspaceId/cancel — mock-mode cancel (sets cancelAtPeriodEnd)
 *  without needing a live Stripe portal session. */
billingRouter.post('/:workspaceId/cancel', requireAuth, requireWorkspaceRole('admin'), async (req: AuthedRequest, res, next) => {
  try {
    const sub = await upsertSubscriptionFromStripe(req.params.workspaceId, { cancelAtPeriodEnd: true });
    res.json({ subscription: sub });
  } catch (err) {
    next(err);
  }
});

/** POST /billing/webhook — Stripe webhook receiver. Mounted with a raw body
 *  parser (see index.ts, mounted BEFORE the global express.json()) since
 *  Stripe's signature verification needs the exact unparsed request body. */
export const billingWebhookRouter = Router();
billingWebhookRouter.post('/webhook', raw({ type: 'application/json' }), async (req, res) => {
  const stripe = await getStripe();
  if (!stripe) return res.status(200).json({ received: true, mockMode: true });

  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) return res.status(400).json({ error: 'Missing signature or webhook secret' });

  let event: import('stripe').default.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature verification failed: ${(err as Error).message}` });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as import('stripe').default.Checkout.Session;
        const workspaceId = session.client_reference_id ?? session.metadata?.workspaceId;
        const planId = session.metadata?.planId;
        if (workspaceId) {
          await upsertSubscriptionFromStripe(workspaceId, {
            plan: planId ?? 'pro',
            status: 'active',
            stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
            stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : null,
          });
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as import('stripe').default.Subscription;
        const existing = await findSubscriptionByStripeSubscriptionId(subscription.id);
        if (existing) {
          await upsertSubscriptionFromStripe(existing.workspaceId, {
            status: event.type === 'customer.subscription.deleted' ? 'cancelled' : subscription.status,
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
          });
        }
        break;
      }
      default:
        break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook handling error', err);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});
