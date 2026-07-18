import { Router } from 'express';
import { z } from 'zod';
import * as tar from 'tar';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { createWorkflow, getWorkflowById } from '../db/workflows';
import { logActivity } from '../db/activity';
import { importN8nWorkflow } from '../utils/importers/n8n';
import { importMakeScenario } from '../utils/importers/make';
import { importZapierZap } from '../utils/importers/zapier';
import { exportToLangGraph } from '../utils/exporters/langgraph';
import { exportToCrewAI } from '../utils/exporters/crewai';
import { exportToPython } from '../utils/exporters/python';
import { exportToDocker } from '../utils/exporters/docker';

/** Mounted at /workflows. Import creates a new workflow from a foreign
 *  automation tool's export; export streams a converted artifact for an
 *  existing FlowForge workflow. */
export const importExportRouter = Router();
importExportRouter.use(requireAuth);

const importSchema = z.object({
  source: z.enum(['n8n', 'make', 'zapier']),
  data: z.unknown(),
  workspaceId: z.string().uuid().nullable().optional(),
});

/** POST /workflows/import — body: { source: 'n8n'|'make'|'zapier', data: <raw export JSON> } */
importExportRouter.post('/import', async (req: AuthedRequest, res, next) => {
  try {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { source, data, workspaceId } = parsed.data;

    const converter = source === 'n8n' ? importN8nWorkflow : source === 'make' ? importMakeScenario : importZapierZap;
    let result: ReturnType<typeof importN8nWorkflow>;
    try {
      result = converter(data);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to parse import' });
    }

    const workflow = await createWorkflow(req.userId!, result.name, result.graph.nodes, result.graph.edges, workspaceId ?? null);
    await logActivity({
      workflowId: workflow.id,
      workspaceId: workspaceId ?? null,
      userId: req.userId,
      action: 'workflow.imported',
      metadata: { source, warningCount: result.warnings.length },
    });
    res.status(201).json({ workflow, warnings: result.warnings });
  } catch (err) {
    next(err);
  }
});

/** GET /workflows/:id/export/:target — target one of langgraph|crewai|python|docker */
importExportRouter.get('/:id/export/:target', async (req: AuthedRequest, res, next) => {
  try {
    const workflow = await getWorkflowById(req.params.id, req.userId!);
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

    const nodes = (workflow.nodesJson ?? []) as import('@flowforge/shared-types').WorkflowNode[];
    const edges = (workflow.edgesJson ?? []) as import('@flowforge/shared-types').WorkflowEdge[];
    const graph = { nodes, edges };

    await logActivity({
      workflowId: workflow.id,
      workspaceId: workflow.workspaceId,
      userId: req.userId,
      action: 'workflow.exported',
      metadata: { target: req.params.target },
    });

    switch (req.params.target) {
      case 'langgraph': {
        const script = exportToLangGraph(graph, workflow.name);
        res.type('text/x-python').setHeader('Content-Disposition', `attachment; filename="${slug(workflow.name)}_langgraph.py"`).send(script);
        return;
      }
      case 'crewai': {
        const script = exportToCrewAI(graph, workflow.name);
        res.type('text/x-python').setHeader('Content-Disposition', `attachment; filename="${slug(workflow.name)}_crewai.py"`).send(script);
        return;
      }
      case 'python': {
        const script = exportToPython(graph, workflow.name);
        res.type('text/x-python').setHeader('Content-Disposition', `attachment; filename="${slug(workflow.name)}.py"`).send(script);
        return;
      }
      case 'docker': {
        const files = exportToDocker(graph, workflow.name);
        const buffer = await tarballFiles(files);
        res
          .type('application/gzip')
          .setHeader('Content-Disposition', `attachment; filename="${slug(workflow.name)}_docker.tar.gz"`)
          .send(buffer);
        return;
      }
      default:
        res.status(400).json({ error: 'Unknown export target. Use langgraph, crewai, python, or docker.' });
    }
  } catch (err) {
    next(err);
  }
});

async function tarballFiles(files: Record<string, string>): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'flowforge-export-'));
  try {
    const names = Object.keys(files);
    await Promise.all(names.map((name) => writeFile(path.join(dir, name), files[name], 'utf8')));
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = tar.c({ gzip: true, cwd: dir }, names);
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve());
      stream.on('error', reject);
    });
    return Buffer.concat(chunks);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'workflow';
}
