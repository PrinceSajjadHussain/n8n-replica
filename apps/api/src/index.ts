import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import type { WorkflowGraph } from '@flowforge/shared-types';
import { authRouter } from './routes/auth';
import { workflowsRouter } from './routes/workflows';
import { credentialsRouter } from './routes/credentials';
import { executionsRouter } from './routes/executions';
import { webhookRouter } from './routes/webhook';
import { initRealtime } from './realtime/socket';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  const sample: WorkflowGraph = { nodes: [], edges: [] };
  res.json({ status: 'ok', sample });
});

app.use('/auth', authRouter);
app.use('/workflows', workflowsRouter);
app.use('/credentials', credentialsRouter);
app.use('/executions', executionsRouter);
app.use('/webhook', webhookRouter);

const httpServer = createServer(app);
initRealtime(httpServer);

const port = process.env.PORT ?? 4000;
httpServer.listen(port, () => {
  console.log(`FlowForge API listening on :${port}`);
});
