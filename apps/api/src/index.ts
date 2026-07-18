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

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  const sample: WorkflowGraph = { nodes: [], edges: [] };
  res.json({ status: 'ok', sample });
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
app.use('/webhook-resume', publicResumeRouter);
app.use('/nodes', nodeTestRouter);
app.use('/ai', aiRouter);
app.use('/templates', templatesRouter);
app.use('/variables', variablesRouter);
app.use('/data-tables', dataTablesRouter);
app.use('/tags', tagsRouter);

const httpServer = createServer(app);
initRealtime(httpServer);

const port = process.env.PORT ?? 4000;
httpServer.listen(port, () => {
  console.log(`FlowForge API listening on :${port}`);
});
