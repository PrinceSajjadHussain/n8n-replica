import { Router } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { createWorkflow } from '../db/workflows';
import type { WorkflowGraph } from '@flowforge/shared-types';

/** Mounted at /templates. A small built-in set of starter workflows so new
 *  users have something to instantiate and explore rather than a blank
 *  canvas — the "workflow template gallery" from the UI-polish checklist.
 *  Kept as static data (not DB-backed) since these ship with the product;
 *  workspaces can still save their own workflows as reusable copies via
 *  the normal duplicate flow. */
export const templatesRouter = Router();
templatesRouter.use(requireAuth);

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  graph: WorkflowGraph;
}

const TEMPLATES: Template[] = [
  {
    id: 'webhook-to-slack',
    name: 'Webhook → Slack notification',
    description: 'Receives a webhook and posts a formatted message to a Slack channel.',
    category: 'Notifications',
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'Webhook', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'slack', label: 'Post to Slack', position: { x: 260, y: 0 }, params: {} },
      ],
      edges: [{ id: 'e1', source: 't1', target: 't2' }],
    },
  },
  {
    id: 'scheduled-report',
    name: 'Scheduled data pull + email report',
    description: 'Runs on a schedule, calls an API, and emails the result.',
    category: 'Scheduling',
    graph: {
      nodes: [
        { id: 't1', type: 'schedule', label: 'Every day at 9am', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'httpRequest', label: 'Fetch data', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'email', label: 'Send report', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
      ],
    },
  },
  {
    id: 'ai-triage',
    name: 'AI ticket triage',
    description: 'Classifies an incoming support ticket with OpenAI and routes it with an IF branch.',
    category: 'AI',
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'New ticket', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'openai', label: 'Classify urgency', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'if', label: 'Is urgent?', position: { x: 520, y: 0 }, params: {} },
        { id: 't4', type: 'slack', label: 'Page on-call', position: { x: 780, y: -80 }, params: {} },
        { id: 't5', type: 'set', label: 'Queue normally', position: { x: 780, y: 80 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't3', target: 't4', sourceHandle: 'true' },
        { id: 'e4', source: 't3', target: 't5', sourceHandle: 'false' },
      ],
    },
  },
  {
    id: 'form-to-sheet',
    name: 'Form submission → Google Sheets',
    description: 'Appends every webhook submission as a new row in a spreadsheet.',
    category: 'Data',
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'Form submitted', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'set', label: 'Shape row', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'googleSheets', label: 'Append row', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
      ],
    },
  },
];

/** GET /templates — the gallery listing. */
templatesRouter.get('/', (_req, res) => {
  res.json({ templates: TEMPLATES.map(({ id, name, description, category }) => ({ id, name, description, category })) });
});

const instantiateSchema = z.object({ workspaceId: z.string().uuid().nullable().optional(), name: z.string().min(1).optional() });

/** POST /templates/:id/use — creates a new workflow from a template. */
templatesRouter.post('/:id/use', async (req: AuthedRequest, res, next) => {
  try {
    const template = TEMPLATES.find((t) => t.id === req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const parsed = instantiateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const workflow = await createWorkflow(
      req.userId!,
      parsed.data.name ?? template.name,
      template.graph.nodes,
      template.graph.edges,
      parsed.data.workspaceId ?? null
    );
    res.status(201).json({ workflow });
  } catch (err) {
    next(err);
  }
});
