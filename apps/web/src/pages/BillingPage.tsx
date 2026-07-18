import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import AppShell from '../components/AppShell';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';

interface PlanDefinition {
  id: string;
  name: string;
  monthlyExecutionLimit: number | null;
  priceUsd: number;
  features: string[];
}

interface Subscription {
  plan: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

interface BillingData {
  subscription: Subscription;
  plan: PlanDefinition;
  plans: PlanDefinition[];
  usage: { period: string; executionCount: number; limit: number | null };
  history: { period: string; executionCount: number }[];
  mockMode: boolean;
}

export default function BillingPage() {
  const { t } = useTranslation();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [data, setData] = useState<BillingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get('/workspaces')
      .then(({ data }) => {
        const ws = data.workspaces?.[0]?.id ?? null;
        if (ws) setWorkspaceId(ws);
        else setError('No workspace found.');
      })
      .catch(() => setError('Could not load your workspace.'));
  }, []);

  async function load(wsId: string) {
    try {
      const { data } = await api.get(`/billing/${wsId}`);
      setData(data);
    } catch {
      setError('Could not load billing information.');
    }
  }

  useEffect(() => {
    if (workspaceId) load(workspaceId);
  }, [workspaceId]);

  async function choosePlan(planId: string) {
    if (!workspaceId) return;
    setBusyPlanId(planId);
    try {
      const { data: res } = await api.post(`/billing/${workspaceId}/checkout`, { planId });
      if (res.url) {
        window.location.href = res.url;
        return;
      }
      await load(workspaceId);
    } catch {
      setError('Could not start checkout for that plan.');
    } finally {
      setBusyPlanId(null);
    }
  }

  async function manageSubscription() {
    if (!workspaceId) return;
    try {
      const { data: res } = await api.post(`/billing/${workspaceId}/portal`);
      if (res.url) {
        window.location.href = res.url;
      } else {
        await api.post(`/billing/${workspaceId}/cancel`);
        await load(workspaceId);
      }
    } catch {
      setError('Could not open the billing portal.');
    }
  }

  const usagePct = data?.usage.limit ? Math.min(100, Math.round((data.usage.executionCount / data.usage.limit) * 100)) : 0;

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t('billing.title')}</h1>
        {data?.mockMode && (
          <p className="text-xs text-muted mt-1">
            No <code>STRIPE_SECRET_KEY</code> configured — running in mock mode. Plan changes apply immediately without a
            real payment flow, so the rest of the product can be evaluated end-to-end.
          </p>
        )}
      </div>

      {error && <p className="text-alert text-sm mb-4">{error}</p>}
      {!data && !error && <p className="text-muted text-sm">Loading…</p>}

      {data && (
        <>
          <Card className="mb-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted mb-1">{t('billing.currentPlan')}</p>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold">{data.plan.name}</span>
                  <Badge variant={data.subscription.status === 'active' ? 'signal' : 'neutral'}>{data.subscription.status}</Badge>
                  {data.subscription.cancelAtPeriodEnd && <Badge variant="amber">Cancels at period end</Badge>}
                </div>
                {data.subscription.currentPeriodEnd && (
                  <p className="text-xs text-muted mt-1">
                    Renews {new Date(data.subscription.currentPeriodEnd).toLocaleDateString()}
                  </p>
                )}
              </div>
              {data.plan.id !== 'free' && (
                <Button variant="secondary" onClick={manageSubscription}>
                  {t('billing.manage')}
                </Button>
              )}
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-muted mb-1">
                <span>
                  {t('billing.usageThisPeriod')} ({data.usage.period})
                </span>
                <span>
                  {data.usage.executionCount.toLocaleString()} {t('billing.executions').toLowerCase()}
                  {data.usage.limit !== null ? ` / ${data.usage.limit.toLocaleString()}` : ' / Unlimited'}
                </span>
              </div>
              {data.usage.limit !== null && (
                <div className="h-2 rounded-full bg-canvas border border-panelBorder overflow-hidden">
                  <div
                    className={`h-full transition-all ${usagePct >= 100 ? 'bg-alert' : usagePct >= 80 ? 'bg-amber-500' : 'bg-signal'}`}
                    style={{ width: `${usagePct}%` }}
                  />
                </div>
              )}
            </div>
          </Card>

          <h2 className="text-sm font-medium text-muted mb-3">{t('billing.choosePlan')}</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {data.plans.map((plan) => {
              const isCurrent = plan.id === data.plan.id;
              return (
                <Card key={plan.id} className={isCurrent ? 'ring-1 ring-signal' : ''}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium">{plan.name}</span>
                    {isCurrent && <Badge variant="signal">Current</Badge>}
                  </div>
                  <p className="text-2xl font-semibold mb-3">
                    ${plan.priceUsd}
                    <span className="text-xs text-muted font-normal">/mo</span>
                  </p>
                  <ul className="space-y-1.5 mb-4">
                    {plan.features.map((f) => (
                      <li key={f} className="text-xs text-muted flex items-start gap-1.5">
                        <span className="text-signal">✓</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full"
                    variant={isCurrent ? 'secondary' : 'primary'}
                    disabled={isCurrent || busyPlanId === plan.id}
                    onClick={() => choosePlan(plan.id)}
                  >
                    {isCurrent ? 'Current plan' : busyPlanId === plan.id ? 'Please wait…' : t('billing.upgrade')}
                  </Button>
                </Card>
              );
            })}
          </div>

          {data.history.length > 1 && (
            <div className="mt-8">
              <h2 className="text-sm font-medium text-muted mb-3">Usage history</h2>
              <div className="space-y-1.5">
                {data.history.map((h) => (
                  <div key={h.period} className="flex items-center justify-between text-xs text-muted border-b border-panelBorder py-1.5">
                    <span>{h.period}</span>
                    <span>{h.executionCount.toLocaleString()} executions</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
