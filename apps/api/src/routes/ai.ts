import { Router } from 'express';
import axios from 'axios';
import { z } from 'zod';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { getDecryptedCredential } from '../db/credentials';

export const aiRouter = Router();
aiRouter.use(requireAuth);

const NODE_CATALOG = `
webhook       (trigger)  params: { path: string }
schedule      (trigger)  params: { cron: string }
httpRequest   (action)   params: { url, method, headers?, body? }
if            (logic)    params: { field, operator: "equals"|"notEquals"|"greaterThan"|"lessThan"|"contains", value }
switch        (logic)    params: { field, cases: [{handle,value}], fallbackToDefault? }  edges use sourceHandle = case handle or "default"
merge         (logic)    params: {}
wait          (logic)    params: { seconds }
forEach       (logic)    params: { itemsPath?, code, batchSize? }  // maps JS over an array, no sub-nodes
forEachBranch (logic)    params: { itemsPath?, subgraph: {nodes,edges}, parallel? }  // true loop: runs a mini-workflow per item
subWorkflow   (logic)    params: { workflowId }  // calls another saved workflow
waitForWebhook (logic)   params: {}  // pauses until POST /webhook-resume/:token
humanApproval (logic)    params: {}  // pauses for a person to approve/reject; branch "true"/"false"
set           (data)     params: { mappings: [{ targetPath, staticValue }] }
code          (data)     params: { code: "return { ... }" }  // JS, receives 'input'
slack         (integration) params: { text }  credential type "slack" { webhookUrl }
email         (integration) params: { to, subject, body } credential type "smtp"
googleSheets  (integration) params: { spreadsheetId, range, values? } credential type "google"
openai        (ai)        params: { model?, systemPrompt?, prompt, temperature?, jsonMode? } credential type "openai" { apiKey }
ragIngest     (ai)        params: { namespace, text? or documents? } credential type "openai"
ragQuery      (ai)        params: { namespace, query, topK?, answerWithModel? } credential type "openai"
agent         (ai)        params: { sessionId?, systemPrompt?, prompt, tools?: [{name,nodeType,description,parameters}], model?, maxSteps?, recentTurns?, longTermMemory?, recallTopK? } credential type "openai" — tool-using agent with short-term + long-term vector memory
agentMemory   (ai)        params: { action: "read"|"write"|"clear"|"recall", sessionId, role?, content?, query?, topK? } credential type "openai" (optional, enables embeddings for write/recall)
agentOrchestrator (ai)    params: { sessionId?, goal, subAgents: [{name,systemPrompt,tools?}], plannerPrompt?, reviewerPrompt?, model? } credential type "openai" — planner -> sub-agents -> reviewer pipeline
browserAutomation (ai)    params: { url, steps: [{action,selector?,value?}] } credential type "browserRunner"
`.trim();

const SYSTEM_PROMPT = `You design automation workflows for FlowForge, an n8n-style tool.
Given a user's plain-English request, output ONLY a JSON object (no markdown fences, no commentary) of the shape:
{
  "name": "Short workflow name",
  "nodes": [ { "id": "n1", "type": "<one of the catalog types>", "position": {"x": number, "y": number}, "params": {...} } ],
  "edges": [ { "id": "e1", "source": "n1", "target": "n2", "sourceHandle": null | "true" | "false" } ]
}
Rules:
- Always start with exactly one trigger node (webhook or schedule) unless the user explicitly says otherwise.
- Space nodes left-to-right: x += 260 per step, keep y around 200-400, branch nodes offset in y.
- Use "if" node's sourceHandle "true"/"false" on its outgoing edges when branching.
- Only use node types from the catalog below. Prefer real integrations (openai, ragIngest/ragQuery, httpRequest, slack) over stubs when relevant.
- Keep params minimal but valid/realistic for the request.
- Do not invent credentialId values; leave credentialId unset (the user attaches credentials afterwards).

Node catalog:
${NODE_CATALOG}`;

const genSchema = z.object({
  prompt: z.string().min(3),
  credentialId: z.string().optional(), // an "openai" credential id; falls back to server OPENAI_API_KEY
  model: z.string().optional(),
});

/**
 * POST /ai/generate-workflow
 * body: { prompt: string, credentialId?: string, model?: string }
 * Returns: { workflow: { name, nodes, edges } }
 *
 * This is the "agent" entry point: describe automation in plain English,
 * get back a ready-to-edit workflow graph on the canvas.
 */
aiRouter.post('/generate-workflow', async (req: AuthedRequest, res) => {
  const parsed = genSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { prompt, credentialId, model } = parsed.data;

  let apiKey = process.env.OPENAI_API_KEY;
  if (credentialId) {
    const cred = await getDecryptedCredential(credentialId, req.userId!);
    if (!cred) return res.status(404).json({ error: 'Credential not found' });
    apiKey = (cred as { apiKey?: string }).apiKey ?? apiKey;
  }
  if (!apiKey) {
    return res.status(400).json({
      error:
        'No OpenAI API key available. Save an "openai" credential ({ "apiKey": "sk-..." }) and pass its id as credentialId, or set OPENAI_API_KEY on the API server.',
    });
  }

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: model ?? 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      },
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 60000 }
    );

    const raw = response.data.choices?.[0]?.message?.content ?? '{}';
    let workflow: unknown;
    try {
      workflow = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: 'AI response was not valid JSON', raw });
    }

    res.json({ workflow });
  } catch (err: unknown) {
    const message = axios.isAxiosError(err)
      ? err.response?.data?.error?.message ?? err.message
      : (err as Error).message;
    res.status(502).json({ error: `AI generation failed: ${message}` });
  }
});

const explainSchema = z.object({
  nodeType: z.string().min(1),
  params: z.record(z.unknown()).optional(),
  error: z.string().min(1),
  input: z.unknown().optional(),
  credentialId: z.string().optional(), // an "openai" credential id; falls back to server OPENAI_API_KEY
  model: z.string().optional(),
});

const EXPLAIN_SYSTEM_PROMPT = `You are a senior automation-platform engineer helping someone debug a failed
node in a FlowForge (n8n/Make-style) workflow. You'll be given the node's type, its
configured params, the error message it raised, and (optionally) the input it received.

Respond with ONLY a JSON object (no markdown fences, no commentary) of the shape:
{
  "diagnosis": "one or two sentences on what most likely went wrong, in plain language",
  "likelyCause": "config" | "credential" | "upstream-data" | "external-service" | "expression" | "other",
  "suggestedFix": "a concrete, actionable next step — e.g. which param to change and to what, or which credential to check",
  "confidence": "low" | "medium" | "high"
}
Be specific to the actual error message and params given — don't give generic troubleshooting advice.`;

/**
 * POST /ai/explain-failure — self-healing-retry building block (Phase 5).
 * body: { nodeType, params?, error, input?, credentialId?, model? }
 * Returns: { diagnosis: {...} }
 *
 * Takes a failed node's config + error (as already surfaced in Execution
 * History's per-node Output panel) and asks the model to name the likely
 * cause and a concrete fix, instead of leaving the person to decode a raw
 * stack trace / API error string. Doesn't re-run anything itself — this is
 * read-only triage; wiring an "Apply fix" action that edits the node's
 * params automatically is a natural next step but out of scope here since
 * it means writing to a live workflow graph unattended.
 */
aiRouter.post('/explain-failure', async (req: AuthedRequest, res) => {
  const parsed = explainSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { nodeType, params, error, input, credentialId, model } = parsed.data;

  let apiKey = process.env.OPENAI_API_KEY;
  if (credentialId) {
    const cred = await getDecryptedCredential(credentialId, req.userId!);
    if (!cred) return res.status(404).json({ error: 'Credential not found' });
    apiKey = (cred as { apiKey?: string }).apiKey ?? apiKey;
  }
  if (!apiKey) {
    return res.status(400).json({
      error:
        'No OpenAI API key available. Save an "openai" credential ({ "apiKey": "sk-..." }) and pass its id as credentialId, or set OPENAI_API_KEY on the API server.',
    });
  }

  const userPrompt = JSON.stringify(
    { nodeType, params: params ?? {}, error, input: input ?? null },
    null,
    2
  );

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: model ?? 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: EXPLAIN_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      },
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 60000 }
    );

    const raw = response.data.choices?.[0]?.message?.content ?? '{}';
    let diagnosis: unknown;
    try {
      diagnosis = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: 'AI response was not valid JSON', raw });
    }

    res.json({ diagnosis });
  } catch (err: unknown) {
    const message = axios.isAxiosError(err)
      ? err.response?.data?.error?.message ?? err.message
      : (err as Error).message;
    res.status(502).json({ error: `AI explanation failed: ${message}` });
  }
});
