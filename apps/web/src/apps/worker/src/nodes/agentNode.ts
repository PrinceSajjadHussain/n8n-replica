import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { NODE_REGISTRY, registerNode } from './types';
import type { NodePlugin, NodeExecutionContext } from './types';

/**
 * AGENT MEMORY
 * ============
 * Two layers, both persisted to disk per sessionId (swap for Redis/Postgres
 * for multi-instance deployments — the read/write functions below are the
 * only thing that would need to change):
 *
 * 1. SHORT-TERM (conversation history) — the last N turns are replayed into
 *    the model's message list verbatim, in order, exactly like a normal
 *    chat thread. This is `readMemory`/`appendMemory`, unchanged in shape
 *    from before.
 *
 * 2. LONG-TERM (vector recall) — every stored turn is also embedded
 *    (OpenAI `text-embedding-3-small`) at write time. Before a run, the
 *    agent embeds the *current* prompt and cosine-similarity-ranks it
 *    against every turn ever stored in that session — not just the recent
 *    window — surfacing older, semantically-relevant turns that fell out
 *    of the short-term window. This is what makes memory survive across
 *    many runs instead of just the last few messages: a fact mentioned 200
 *    turns ago can still be recalled if the current prompt is about it.
 *    See `semanticRecall` below. Embeddings are optional — if no OpenAI key
 *    is available, the agent still works with short-term memory only.
 */
const MEMORY_DIR = process.env.AGENT_MEMORY_DIR ?? '/tmp/flowforge-agent-memory';

interface MemoryTurn {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  at: string;
  /** OpenAI embedding of `content`, computed at write time when an API key is available. */
  embedding?: number[];
}

export interface RecalledMemory {
  role: MemoryTurn['role'];
  content: string;
  at: string;
  score: number;
}

function memoryPath(sessionId: string) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(MEMORY_DIR, `${safe}.json`);
}

function readMemory(sessionId: string): MemoryTurn[] {
  const p = memoryPath(sessionId);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function writeMemory(sessionId: string, turns: MemoryTurn[]) {
  fs.writeFileSync(memoryPath(sessionId), JSON.stringify(turns));
}

function appendMemory(sessionId: string, turns: MemoryTurn[]) {
  writeMemory(sessionId, [...readMemory(sessionId), ...turns]);
}

async function embedTexts(apiKey: string, texts: string[]): Promise<number[][]> {
  const response = await axios.post(
    'https://api.openai.com/v1/embeddings',
    { model: 'text-embedding-3-small', input: texts },
    { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 60000 }
  );
  return response.data.data.map((d: { embedding: number[] }) => d.embedding);
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/**
 * Appends turns to a session's memory, embedding their content first when
 * an API key is available. Embedding failures never block the run — the
 * turn is still stored (without an `embedding`), it just won't surface via
 * long-term recall later.
 */
async function appendMemoryWithEmbeddings(sessionId: string, turns: MemoryTurn[], apiKey?: string) {
  if (!apiKey) return appendMemory(sessionId, turns);
  try {
    const vectors = await embedTexts(apiKey, turns.map((t) => t.content || ' '));
    appendMemory(sessionId, turns.map((t, i) => ({ ...t, embedding: vectors[i] })));
  } catch {
    appendMemory(sessionId, turns); // degrade gracefully to short-term-only for these turns
  }
}

/**
 * Long-term vector recall: ranks every embedded turn in the session
 * (optionally excluding the most recent `excludeRecent` turns, which are
 * already in the short-term window and would just be noise here) against
 * the query by cosine similarity and returns the topK best matches.
 */
async function semanticRecall(
  sessionId: string,
  apiKey: string,
  query: string,
  topK: number,
  excludeRecent = 0
): Promise<RecalledMemory[]> {
  const all = readMemory(sessionId);
  const candidates = excludeRecent > 0 ? all.slice(0, Math.max(0, all.length - excludeRecent)) : all;
  const embedded = candidates.filter((t): t is MemoryTurn & { embedding: number[] } => !!t.embedding?.length);
  if (embedded.length === 0 || !query.trim()) return [];
  const [queryEmbedding] = await embedTexts(apiKey, [query]);
  return embedded
    .map((t) => ({ role: t.role, content: t.content, at: t.at, score: cosineSim(queryEmbedding, t.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * agentMemory — read/write/clear/recall a session's memory directly, for
 * workflows that want manual control over what an agent "remembers".
 * params:
 *   action: 'read' | 'write' | 'clear' | 'recall'
 *   sessionId: string
 *   role?, content?       — for 'write'
 *   query?, topK?          — for 'recall' (semantic/vector search over ALL
 *                            stored turns, not just the recent window)
 * credential (optional, type 'openai'): { apiKey } — enables embedding on
 * 'write' and is required for 'recall' to return anything.
 */
export const agentMemoryNode: NodePlugin = {
  type: 'agentMemory',
  async execute({ params, credential }) {
    const sessionId = String(params.sessionId ?? 'default');
    const action = String(params.action ?? 'read');
    const apiKey = (credential?.apiKey as string) ?? process.env.OPENAI_API_KEY;
    if (action === 'read') return { output: { turns: readMemory(sessionId) } };
    if (action === 'clear') {
      const p = memoryPath(sessionId);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return { output: { cleared: true, sessionId } };
    }
    if (action === 'write') {
      const turn: MemoryTurn = {
        role: (params.role as MemoryTurn['role']) ?? 'user',
        content: String(params.content ?? ''),
        at: new Date().toISOString(),
      };
      await appendMemoryWithEmbeddings(sessionId, [turn], apiKey);
      return { output: { written: true, sessionId, embedded: !!apiKey } };
    }
    if (action === 'recall') {
      if (!apiKey) {
        return {
          output: {
            matches: [],
            note: 'agentMemory recall: no OpenAI credential/OPENAI_API_KEY available for embeddings.',
          },
        };
      }
      const matches = await semanticRecall(sessionId, apiKey, String(params.query ?? ''), Number(params.topK ?? 5));
      return { output: { matches, sessionId } };
    }
    throw new Error(`agentMemory node: unknown action "${action}"`);
  },
};

/**
 * TOOL ABSTRACTION
 * ================
 * Wraps ANY registered node type as a callable "tool" the agent's model can
 * invoke, by describing it with a JSON-schema-ish spec and dispatching the
 * model's chosen tool call back through NODE_REGISTRY. This is what lets a
 * workflow expose Slack/Notion/HTTP/etc. nodes to the agent without
 * bespoke per-integration agent code.
 */
export interface AgentToolSpec {
  name: string; // tool name shown to the model
  nodeType: string; // which NODE_REGISTRY entry this dispatches to
  description: string;
  parameters: Record<string, unknown>; // JSON schema `properties`
  credential?: Record<string, unknown> | null; // credential to inject when the node executes
  staticParams?: Record<string, unknown>; // params always merged in (e.g. fixed channel)
}

async function runTool(spec: AgentToolSpec, modelArgs: Record<string, unknown>) {
  const node = NODE_REGISTRY[spec.nodeType];
  if (!node) throw new Error(`agent tool "${spec.name}": node type "${spec.nodeType}" is not registered`);
  const ctx: NodeExecutionContext = {
    input: modelArgs,
    items: [{ json: modelArgs, pairedItem: { item: 0 } }],
    params: { ...(spec.staticParams ?? {}), ...modelArgs },
    credential: spec.credential ?? null,
    getBinary: () => null,
    toBinary: (buffer: Buffer, mimeType: string, fileName?: string) => ({
      mimeType,
      fileName,
      fileSize: buffer.length,
      data: buffer.toString('base64'),
    }),
  };
  const result = await node.execute(ctx);
  return result.output ?? result.items ?? null;
}

/**
 * agent — a tool-using AI agent. Give it a list of AgentToolSpec entries
 * (params.tools) and it will loop: call the model -> if it requests a tool
 * call, dispatch it through runTool() -> feed the result back -> repeat,
 * until the model returns a final answer or maxSteps is hit. Conversation
 * history persists across runs via params.sessionId + agentMemory.
 *
 * credential (type 'openai'): { apiKey: string }
 * params:
 *   sessionId?: string        default 'default' — memory scope
 *   systemPrompt?: string
 *   prompt: string            this turn's user message
 *   tools?: AgentToolSpec[]
 *   model?: string            default 'gpt-4o-mini'
 *   maxSteps?: number         default 6
 *   recentTurns?: number      default 12 — how many recent turns go into the
 *                             short-term (verbatim) context window
 *   longTermMemory?: boolean  default true — semantically recall older turns
 *                             outside the recent window (see agentNode.ts
 *                             header comment on the two memory layers)
 *   recallTopK?: number       default 4 — how many long-term memories to recall
 */
export const agentNode: NodePlugin = {
  type: 'agent',
  async execute({ params, credential }) {
    const apiKey = (credential?.apiKey as string) ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('agent node: requires an "openai" credential with { "apiKey": "sk-..." }');

    const sessionId = String(params.sessionId ?? 'default');
    const model = String(params.model ?? 'gpt-4o-mini');
    const maxSteps = Number(params.maxSteps ?? 6);
    const tools = (params.tools as AgentToolSpec[]) ?? [];
    const userPrompt = String(params.prompt ?? '');
    const recentTurns = Number(params.recentTurns ?? 12);
    const longTermMemoryEnabled = params.longTermMemory !== false;
    const recallTopK = Number(params.recallTopK ?? 4);

    const fullHistory = readMemory(sessionId);
    const recentHistory = recentTurns > 0 ? fullHistory.slice(-recentTurns) : fullHistory;

    // Long-term vector recall: search the ENTIRE session history (not just
    // the recent window above) for turns semantically relevant to this
    // prompt, so facts from long ago can still surface.
    let recalledMemories: RecalledMemory[] = [];
    if (longTermMemoryEnabled) {
      try {
        recalledMemories = await semanticRecall(sessionId, apiKey, userPrompt, recallTopK, recentHistory.length);
      } catch {
        recalledMemories = []; // embeddings unavailable/failed — carry on with short-term memory only
      }
    }

    const messages: Array<Record<string, unknown>> = [];
    if (params.systemPrompt) messages.push({ role: 'system', content: String(params.systemPrompt) });
    if (recalledMemories.length > 0) {
      messages.push({
        role: 'system',
        content:
          'Relevant memories recalled from earlier in this session (not necessarily recent):\n' +
          recalledMemories.map((m) => `- (${m.role}, ${m.at}) ${m.content}`).join('\n'),
      });
    }
    for (const turn of recentHistory) {
      if (turn.role === 'tool') continue; // tool results are re-derived per-run, not replayed
      messages.push({ role: turn.role, content: turn.content });
    }
    messages.push({ role: 'user', content: userPrompt });

    const openaiTools = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: { type: 'object', properties: t.parameters } },
    }));

    const trace: Array<Record<string, unknown>> = [];
    if (recalledMemories.length > 0) {
      trace.push({ step: -1, type: 'recall', query: userPrompt, matches: recalledMemories });
    }
    let finalText = '';

    for (let step = 0; step < maxSteps; step++) {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        { model, messages, ...(openaiTools.length ? { tools: openaiTools } : {}) },
        { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 }
      );
      const choice = response.data.choices?.[0];
      const message = choice?.message ?? {};
      messages.push(message);

      const toolCalls = message.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }> | undefined;
      if (!toolCalls || toolCalls.length === 0) {
        finalText = message.content ?? '';
        trace.push({ step, type: 'final', content: finalText });
        break;
      }

      for (const call of toolCalls) {
        const spec = tools.find((t) => t.name === call.function.name);
        let toolResult: unknown;
        try {
          const args = JSON.parse(call.function.arguments || '{}');
          toolResult = spec ? await runTool(spec, args) : { error: `unknown tool ${call.function.name}` };
        } catch (err) {
          toolResult = { error: err instanceof Error ? err.message : String(err) };
        }
        trace.push({ step, type: 'tool_call', tool: call.function.name, args: call.function.arguments, result: toolResult });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(toolResult) });
      }
    }

    await appendMemoryWithEmbeddings(
      sessionId,
      [
        { role: 'user', content: userPrompt, at: new Date().toISOString() },
        { role: 'assistant', content: finalText, at: new Date().toISOString() },
      ],
      apiKey
    );

    return {
      output: {
        answer: finalText,
        trace,
        sessionId,
        steps: trace.length,
        recalledMemories, // long-term matches surfaced for this run, for UI/debugging
      },
    };
  },
};

/**
 * MULTI-AGENT ORCHESTRATION
 * =========================
 * agentOrchestrator — runs a planner -> N sub-agents -> reviewer pipeline,
 * all sharing one memory session so each stage sees prior context. Each
 * stage is itself just an `agent` node invocation with a different system
 * prompt, so you get real tool-use, short-term history, AND long-term
 * vector recall at every stage for free — a sub-agent run today can recall
 * something the reviewer said in a run from last week, since they share
 * `sessionId`.
 *
 * params:
 *   sessionId?: string
 *   goal: string                       the overall objective
 *   plannerPrompt?: string             default instructs it to break the goal into subtasks (as a JSON list)
 *   subAgents: Array<{ name: string, systemPrompt: string, tools?: AgentToolSpec[] }>
 *   reviewerPrompt?: string            default instructs it to synthesize/critique sub-agent outputs
 *   model?: string
 */
export const agentOrchestratorNode: NodePlugin = {
  type: 'agentOrchestrator',
  async execute({ params, credential }) {
    const sessionId = String(params.sessionId ?? `orchestrator-${Date.now()}`);
    const model = String(params.model ?? 'gpt-4o-mini');
    const goal = String(params.goal ?? '');
    const subAgents = (params.subAgents as Array<{ name: string; systemPrompt: string; tools?: AgentToolSpec[] }>) ?? [];

    const runStage = async (systemPrompt: string, prompt: string, tools: AgentToolSpec[] = []) =>
      agentNode.execute({
        input: null,
        items: [],
        credential,
        getBinary: () => null,
        toBinary: (buffer: Buffer, mimeType: string, fileName?: string) => ({
          mimeType,
          fileName,
          fileSize: buffer.length,
          data: buffer.toString('base64'),
        }),
        params: { sessionId, model, systemPrompt, prompt, tools, maxSteps: 6 },
      });

    // 1. Planner: break the goal into subtasks routed to named sub-agents.
    const plannerPrompt =
      (params.plannerPrompt as string) ??
      `Break this goal into a JSON array of subtasks, one per available agent (${subAgents
        .map((a) => a.name)
        .join(', ')}). Respond with ONLY a JSON array of { "agent": name, "task": string }.`;
    const plannerResult = await runStage('You are a planning agent for a multi-agent workflow.', `${plannerPrompt}\n\nGoal: ${goal}`);
    let plan: Array<{ agent: string; task: string }> = [];
    try {
      plan = JSON.parse((plannerResult.output as { answer: string }).answer);
    } catch {
      // Fall back: give the whole goal to every sub-agent if planning output wasn't parseable JSON.
      plan = subAgents.map((a) => ({ agent: a.name, task: goal }));
    }

    // 2. Sub-agents: execute each planned subtask with its own tools/system prompt.
    const subResults: Array<Record<string, unknown>> = [];
    for (const step of plan) {
      const agentSpec = subAgents.find((a) => a.name === step.agent);
      if (!agentSpec) {
        subResults.push({ agent: step.agent, task: step.task, error: 'no matching sub-agent configured' });
        continue;
      }
      const result = await runStage(agentSpec.systemPrompt, step.task, agentSpec.tools ?? []);
      subResults.push({ agent: step.agent, task: step.task, ...(result.output as Record<string, unknown>) });
    }

    // 3. Reviewer: synthesize sub-agent outputs into one final answer.
    const reviewerPrompt =
      (params.reviewerPrompt as string) ??
      'Synthesize the sub-agent results below into one final, coherent answer to the original goal. Note any contradictions.';
    const reviewResult = await runStage(
      'You are a reviewing/synthesizing agent for a multi-agent workflow.',
      `${reviewerPrompt}\n\nGoal: ${goal}\n\nSub-agent results:\n${JSON.stringify(subResults, null, 2)}`
    );

    return {
      output: {
        goal,
        plan,
        subResults,
        finalAnswer: (reviewResult.output as { answer: string }).answer,
        sessionId,
        // reasoning trace across every stage, for visualization in the UI
        trace: [
          { stage: 'planner', ...(plannerResult.output as Record<string, unknown>) },
          ...subResults.map((r, i) => ({ stage: `subAgent:${plan[i]?.agent}`, ...r })),
          { stage: 'reviewer', ...(reviewResult.output as Record<string, unknown>) },
        ],
      },
    };
  },
};

registerNode(agentMemoryNode);
registerNode(agentNode);
registerNode(agentOrchestratorNode);
