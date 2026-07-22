import './loadEnv';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import type { WorkflowGraph } from '@flowforge/shared-types';
import { authRouter } from './routes/auth';
import { workflowsRouter } from './routes/workflows';
import { workflowVersionsRouter } from './routes/workflowVersions';
import { marketplaceRouter } from './routes/marketplace';
import { credentialsRouter } from './routes/credentials';
import { executionsRouter } from './routes/executions';
import { webhookRouter } from './routes/webhook';
import { formRouter } from './routes/form';
import { chatRouter } from './routes/chat';
import { aiRouter } from './routes/ai';
import { resumeRouter, publicResumeRouter } from './routes/resume';
import { nodeTestRouter } from './routes/nodeTest';
import { initRealtime } from './realtime/socket';
import { workspacesRouter } from './routes/workspaces';
import { foldersRouter } from './routes/folders';
import { commentsRouter } from './routes/comments';
import { alertsRouter } from './routes/alerts';
import { workspaceActivityRouter, workflowActivityRouter } from './routes/activity';
import { templatesRouter } from './routes/templates';
import { variablesRouter } from './routes/variables';
import { dataTablesRouter } from './routes/dataTables';
import { workflowTestsRouter } from './routes/workflowTests';
import { tagsRouter } from './routes/tags';
import { logStreamsRouter } from './routes/logStreams';
import { queueAdminRouter } from './routes/queueAdmin';
import { billingRouter, billingWebhookRouter } from './routes/billing';
import { expressionsRouter } from './routes/expressions';
import { pool } from './db/pool';
import { createRedisConnection } from './queue/queue';
import { reconcileAllWorkflowPollersOnBoot } from './utils/triggerActivation';

const app = express();
app.use(cors());
// Stripe webhook needs the raw, unparsed body for signature verification —
// mounted ahead of the global express.json() below so it never gets parsed.
app.use('/billing', billingWebhookRouter);
// Capture the exact raw bytes of every JSON body as `req.rawBody` alongside
// the normal parsed `req.body`. Needed by the `calendlyTrigger` /
// `docusignTrigger` webhook nodes (see routes/webhook.ts +
// utils/webhookSignature.ts), which must HMAC the *exact* bytes the sender
// signed — re-serializing `req.body` can silently break the signature on
// key-order/whitespace differences. Cheap (buffers are already in flight)
// and non-breaking for every other route, which keeps using `req.body`.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req, res) => {
  const sample: WorkflowGraph = { nodes: [], edges: [] };
  res.json({ status: 'ok', sample });
});

/**
 * GET /ready — readiness probe (k8s-style), distinct from /health's plain
 * liveness check. Actually verifies the API can reach its two hard
 * dependencies (Postgres, Redis) rather than just confirming the Express
 * process is up. Point a readiness probe at this so a load balancer/
 * orchestrator stops routing traffic here during a DB/Redis outage instead
 * of returning 500s to users.
 */
const readinessRedis = createRedisConnection();
app.get('/ready', async (_req, res) => {
  const checks: Record<string, 'ok' | 'error'> = { database: 'ok', redis: 'ok' };
  try {
    await pool.query('SELECT 1');
  } catch {
    checks.database = 'error';
  }
  try {
    await readinessRedis.ping();
  } catch {
    checks.redis = 'error';
  }
  const healthy = Object.values(checks).every((v) => v === 'ok');
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ready' : 'not ready', checks });
});

app.use('/auth', authRouter);
app.use('/workflows', workflowsRouter);
app.use('/workflows', workflowVersionsRouter);
app.use('/workflows', commentsRouter);
app.use('/workflows', alertsRouter);
app.use('/workflows', workflowActivityRouter);
app.use('/workflows', workflowTestsRouter);
app.use('/workspaces', workspacesRouter);
app.use('/workspaces', foldersRouter);
app.use('/workspaces', workspaceActivityRouter);
app.use('/workspaces', logStreamsRouter);
app.use('/marketplace', marketplaceRouter);
app.use('/credentials', credentialsRouter);
app.use('/executions', executionsRouter);
app.use('/executions', resumeRouter);
app.use('/webhook', webhookRouter);
app.use('/form', formRouter);
app.use('/chat', chatRouter);
app.use('/webhook-resume', publicResumeRouter);
app.use('/nodes', nodeTestRouter);
app.use('/ai', aiRouter);
app.use('/templates', templatesRouter);
app.use('/variables', variablesRouter);
app.use('/data-tables', dataTablesRouter);
app.use('/tags', tagsRouter);
app.use('/queue', queueAdminRouter);
app.use('/billing', billingRouter);
app.use('/expressions', expressionsRouter);

const httpServer = createServer(app);
initRealtime(httpServer);

const port = process.env.PORT ?? 4000;
httpServer.listen(port, () => {
  console.log(`FlowForge API listening on :${port}`);
  reconcileAllWorkflowPollersOnBoot().catch((err) =>
    console.error('Boot-time trigger poller reconciliation failed:', err instanceof Error ? err.message : err)
  );
});
