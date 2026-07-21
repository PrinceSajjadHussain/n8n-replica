import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { NODE_REGISTRY, registerNode } from './types';
import type { NodePlugin, NodeExecutionContext } from './types';
import { readRedisTurns, appendRedisTurns } from './redisMemoryNode';

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

async function runTool(
  spec: AgentToolSpec,
  modelArgs: Record<string, unknown>,
  outer: Pick<NodeExecutionContext, 'workflowId' | 'workspaceId' | 'staticData' | 'setStaticData'>
) {
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
    workflowId: outer.workflowId,
    workspaceId: outer.workspaceId,
    staticData: outer.staticData,
    setStaticData: outer.setStaticData,
  };
  const result = await node.execute(ctx);
  return result.output ?? result.items ?? null;
}

/**
 * MULTI-PROVIDER MODEL CALLS
 * ==========================
 * The agent loop used to be hard-wired to OpenAI's Chat Completions API, so
 * an "AI Agent" node could only ever run on an OpenAI credential — picking
 * Gemini/Anthropic from the credential picker did nothing. This normalizes
 * a tiny "transcript" shape across providers so the same tool-use loop below
 * works no matter which one is selected via `params.provider`.
 */
export type AgentProvider = 'openai' | 'anthropic' | 'gemini';

export interface AgentTurn {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Present on an assistant turn that called one or more tools instead of answering directly. */
  toolCalls?: { id: string; name: string; args: string }[];
  /** Present on a 'tool' turn — which call this result answers. */
  toolCallId?: string;
  toolName?: string;
}

interface ModelStepResult {
  /** Non-empty when the model answered directly (no further tool calls this step). */
  text: string | null;
  toolCalls: { id: string; name: string; args: string }[];
}

function resolveAgentApiKey(provider: AgentProvider, credential: Record<string, unknown> | null): string {
  const fromCredential = credential?.apiKey as string | undefined;
  const fromEnv =
    provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY
    : provider === 'gemini' ? (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)
    : process.env.OPENAI_API_KEY;
  const apiKey = fromCredential ?? fromEnv;
  if (!apiKey) {
    const credLabel = provider === 'anthropic' ? 'anthropic' : provider === 'gemini' ? 'gemini' : 'openai';
    throw new Error(
      `agent node: no API key for provider "${provider}". Add a "${credLabel}" credential and select it on this node (or set the matching *_API_KEY env var on the worker).`
    );
  }
  return apiKey;
}

async function callOpenAiStep(
  model: string,
  apiKey: string,
  transcript: AgentTurn[],
  tools: AgentToolSpec[]
): Promise<ModelStepResult> {
  const messages = transcript.map((t) => {
    if (t.role === 'assistant' && t.toolCalls?.length) {
      return {
        role: 'assistant',
        content: t.content || null,
        tool_calls: t.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.args } })),
      };
    }
    if (t.role === 'tool') return { role: 'tool', tool_call_id: t.toolCallId, content: t.content };
    return { role: t.role, content: t.content };
  });
  const openaiTools = tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: { type: 'object', properties: t.parameters } },
  }));
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    { model, messages, ...(openaiTools.length ? { tools: openaiTools } : {}) },
    { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 }
  );
  const message = response.data.choices?.[0]?.message ?? {};
  const toolCalls = (message.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }> | undefined) ?? [];
  if (toolCalls.length > 0) {
    return { text: null, toolCalls: toolCalls.map((tc) => ({ id: tc.id, name: tc.function.name, args: tc.function.arguments })) };
  }
  return { text: message.content ?? '', toolCalls: [] };
}

async function callAnthropicStep(
  model: string,
  apiKey: string,
  transcript: AgentTurn[],
  tools: AgentToolSpec[]
): Promise<ModelStepResult> {
  const systemText = transcript.filter((t) => t.role === 'system').map((t) => t.content).join('\n\n');
  const messages: Array<Record<string, unknown>> = [];
  for (const t of transcript) {
    if (t.role === 'system') continue;
    if (t.role === 'assistant' && t.toolCalls?.length) {
      const blocks: Record<string, unknown>[] = [];
      if (t.content) blocks.push({ type: 'text', text: t.content });
      for (const tc of t.toolCalls) {
        let input: unknown = {};
        try {
          input = JSON.parse(tc.args || '{}');
        } catch {
          input = {};
        }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input });
      }
      messages.push({ role: 'assistant', content: blocks });
    } else if (t.role === 'tool') {
      messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: t.toolCallId, content: t.content }] });
    } else {
      messages.push({ role: t.role, content: t.content });
    }
  }
  const anthropicTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: { type: 'object', properties: t.parameters },
  }));
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model,
      max_tokens: 4096,
      ...(systemText ? { system: systemText } : {}),
      messages,
      ...(anthropicTools.length ? { tools: anthropicTools } : {}),
    },
    { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, timeout: 60000 }
  );
  const blocks = (response.data.content ?? []) as Array<Record<string, unknown>>;
  const toolUseBlocks = blocks.filter((b) => b.type === 'tool_use');
  if (toolUseBlocks.length > 0) {
    return {
      text: null,
      toolCalls: toolUseBlocks.map((b) => ({
        id: String(b.id),
        name: String(b.name),
        args: JSON.stringify(b.input ?? {}),
      })),
    };
  }
  const text = blocks.filter((b) => b.type === 'text').map((b) => String(b.text ?? '')).join('');
  return { text, toolCalls: [] };
}

async function callGeminiStep(
  model: string,
  apiKey: string,
  transcript: AgentTurn[],
  tools: AgentToolSpec[]
): Promise<ModelStepResult> {
  const systemText = transcript.filter((t) => t.role === 'system').map((t) => t.content).join('\n\n');
  const contents: Array<Record<string, unknown>> = [];
  for (const t of transcript) {
    if (t.role === 'system') continue;
    if (t.role === 'assistant' && t.toolCalls?.length) {
      contents.push({
        role: 'model',
        parts: t.toolCalls.map((tc) => {
          let args: unknown = {};
          try {
            args = JSON.parse(tc.args || '{}');
          } catch {
            args = {};
          }
          return { functionCall: { name: tc.name, args } };
        }),
      });
    } else if (t.role === 'tool') {
      let response: unknown;
      try {
        response = JSON.parse(t.content);
      } catch {
        response = { result: t.content };
      }
      contents.push({ role: 'function', parts: [{ functionResponse: { name: t.toolName ?? 'tool', response } }] });
    } else {
      contents.push({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.content }] });
    }
  }
  const geminiTools = tools.length
    ? [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: { type: 'OBJECT', properties: t.parameters } })) }]
    : undefined;
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      contents,
      ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
      ...(geminiTools ? { tools: geminiTools } : {}),
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 60000 }
  );
  const parts = (response.data.candidates?.[0]?.content?.parts ?? []) as Array<Record<string, unknown>>;
  const functionCallParts = parts.filter((p) => p.functionCall);
  if (functionCallParts.length > 0) {
    return {
      text: null,
      toolCalls: functionCallParts.map((p, i) => {
        const fc = p.functionCall as { name: string; args?: unknown };
        return { id: `${fc.name}-${Date.now()}-${i}`, name: fc.name, args: JSON.stringify(fc.args ?? {}) };
      }),
    };
  }
  const text = parts.filter((p) => typeof p.text === 'string').map((p) => String(p.text)).join('');
  return { text, toolCalls: [] };
}

async function callAgentModel(
  provider: AgentProvider,
  model: string,
  apiKey: string,
  transcript: AgentTurn[],
  tools: AgentToolSpec[]
): Promise<ModelStepResult> {
  if (provider === 'anthropic') return callAnthropicStep(model, apiKey, transcript, tools);
  if (provider === 'gemini') return callGeminiStep(model, apiKey, transcript, tools);
  return callOpenAiStep(model, apiKey, transcript, tools);
}

function defaultModelFor(provider: AgentProvider): string {
  if (provider === 'anthropic') return 'claude-sonnet-4-5-20250929';
  if (provider === 'gemini') return 'gemini-2.0-flash';
  return 'gpt-4o-mini';
}

 /* call, dispatch it through runTool() -> feed the result back -> repeat,
 * until the model returns a final answer or maxSteps is hit. Conversation
 * history persists across runs via params.sessionId + agentMemory.
 *
 * credential (type matches `params.provider`): { apiKey: string }
 * params:
 *   provider?: 'openai' | 'anthropic' | 'gemini'   default 'openai'
 *   sessionId?: string        default 'default' — memory scope
 *   systemPrompt?: string
 *   prompt: string            this turn's user message
 *   tools?: AgentToolSpec[]
 *   model?: string            default depends on provider (e.g. 'gpt-4o-mini' for openai)
 *   maxSteps?: number         default 6
 *   recentTurns?: number      default 12 — how many recent turns go into the
 *                             short-term (verbatim) context window
 *   longTermMemory?: boolean  default true — semantically recall older turns
 *                             outside the recent window (see agentNode.ts
 *                             header comment on the two memory layers).
 *                             Long-term recall always uses OpenAI embeddings
 *                             regardless of `provider` — if no OpenAI key is
 *                             available it's skipped automatically, the rest
 *                             of the agent still runs fine on any provider.
 *   recallTopK?: number       default 4 — how many long-term memories to recall
 */
export const agentNode: NodePlugin = {
  type: 'agent',
  async execute({ params, credential, workflowId, workspaceId, staticData, setStaticData }) {
    const provider = ((): AgentProvider => {
      const p = String(params.provider ?? 'openai').toLowerCase();
      return p === 'anthropic' || p === 'gemini' ? p : 'openai';
    })();
    const apiKey = resolveAgentApiKey(provider, credential);
    // Long-term semantic recall (below) is OpenAI-embeddings-only — reuse
    // an OpenAI credential/env key for it when one's available, but never
    // require it when running on a different provider.
    const embeddingApiKey = provider === 'openai' ? apiKey : (process.env.OPENAI_API_KEY ?? null);

    const sessionId = String(params.sessionId ?? 'default');
    const model = String(params.model ?? defaultModelFor(provider));
    const maxSteps = Number(params.maxSteps ?? 6);
    // Tools come from two places: the flat params.tools array (set directly
    // in the form) and any agentTool sub-nodes wired into the Agent's "Tool"
    // port (see executor.ts's $subNodes resolution + subConfigNodes.ts) —
    // both are supported so existing workflows built before the Tool
    // sub-node existed keep working.
    const subNodes = (params.$subNodes ?? {}) as Record<string, any>;
    const toolSubNodesRaw = subNodes.tool;
    const toolSubNodes: any[] = toolSubNodesRaw == null ? [] : Array.isArray(toolSubNodesRaw) ? toolSubNodesRaw : [toolSubNodesRaw];
    const toolsFromSubNodes: AgentToolSpec[] = toolSubNodes.map((t) => ({
      name: String(t.name ?? 'tool'),
      nodeType: String(t.nodeType ?? 'httpRequest'),
      description: String(t.description ?? ''),
      parameters: (t.parameters as Record<string, unknown>) ?? {},
      staticParams: (t.nodeParams as Record<string, unknown>) ?? {},
    }));
    const tools = [...((params.tools as AgentToolSpec[]) ?? []), ...toolsFromSubNodes];
    const userPrompt = String(params.prompt ?? '');
    const recentTurns = Number(params.recentTurns ?? 12);
    const longTermMemoryEnabled = params.longTermMemory !== false;
    const recallTopK = Number(params.recallTopK ?? 4);

    // If a Redis Chat Memory node is wired into this Agent's "Memory" port,
    // use it for short-term history instead of the local per-worker JSON
    // file — this is what makes that connection (see image showing Agent ->
    // Memory: Redis Chat Memory) actually shared across worker instances
    // instead of being a purely decorative wire. Long-term semantic recall
    // below still requires the local embedding store, so it's skipped in
    // Redis mode (Redis turns aren't embedded) — short-term history alone
    // still works fully.
    const memorySub = subNodes.memory as Record<string, unknown> | undefined;
    const useRedisMemory = memorySub?.$nodeType === 'redisMemory';

    const fullHistory: MemoryTurn[] = useRedisMemory
      ? (await readRedisTurns(sessionId, 500))
          .filter((t) => t.role === 'user' || t.role === 'assistant')
          .map((t) => ({ role: t.role as 'user' | 'assistant', content: t.content, at: t.at }))
      : readMemory(sessionId);
    const recentHistory = recentTurns > 0 ? fullHistory.slice(-recentTurns) : fullHistory;

    // Long-term vector recall: search the ENTIRE session history (not just
    // the recent window above) for turns semantically relevant to this
    // prompt, so facts from long ago can still surface.
    let recalledMemories: RecalledMemory[] = [];
    if (longTermMemoryEnabled && embeddingApiKey) {
      try {
        recalledMemories = await semanticRecall(sessionId, embeddingApiKey, userPrompt, recallTopK, recentHistory.length);
      } catch {
        recalledMemories = []; // embeddings unavailable/failed — carry on with short-term memory only
      }
    }

    const transcript: AgentTurn[] = [];
    if (params.systemPrompt) transcript.push({ role: 'system', content: String(params.systemPrompt) });
    if (recalledMemories.length > 0) {
      transcript.push({
        role: 'system',
        content:
          'Relevant memories recalled from earlier in this session (not necessarily recent):\n' +
          recalledMemories.map((m) => `- (${m.role}, ${m.at}) ${m.content}`).join('\n'),
      });
    }
    for (const turn of recentHistory) {
      if (turn.role === 'tool') continue; // tool results are re-derived per-run, not replayed
      transcript.push({ role: turn.role, content: turn.content });
    }
    transcript.push({ role: 'user', content: userPrompt });

    const trace: Array<Record<string, unknown>> = [];
    if (recalledMemories.length > 0) {
      trace.push({ step: -1, type: 'recall', query: userPrompt, matches: recalledMemories });
    }
    let finalText = '';

    for (let step = 0; step < maxSteps; step++) {
      const result = await callAgentModel(provider, model, apiKey, transcript, tools);

      if (result.toolCalls.length === 0) {
        finalText = result.text ?? '';
        transcript.push({ role: 'assistant', content: finalText });
        trace.push({ step, type: 'final', content: finalText });
        break;
      }

      transcript.push({ role: 'assistant', content: '', toolCalls: result.toolCalls });

      for (const call of result.toolCalls) {
        const spec = tools.find((t) => t.name === call.name);
        let toolResult: unknown;
        try {
          const args = JSON.parse(call.args || '{}');
          toolResult = spec
            ? await runTool(spec, args, { workflowId, workspaceId, staticData, setStaticData })
            : { error: `unknown tool ${call.name}` };
        } catch (err) {
          toolResult = { error: err instanceof Error ? err.message : String(err) };
        }
        trace.push({ step, type: 'tool_call', tool: call.name, args: call.args, result: toolResult });
        transcript.push({ role: 'tool', content: JSON.stringify(toolResult), toolCallId: call.id, toolName: call.name });
      }
    }

    if (useRedisMemory) {
      await appendRedisTurns(sessionId, [
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: finalText },
      ]);
    } else {
      await appendMemoryWithEmbeddings(
        sessionId,
        [
          { role: 'user', content: userPrompt, at: new Date().toISOString() },
          { role: 'assistant', content: finalText, at: new Date().toISOString() },
        ],
        embeddingApiKey ?? undefined
      );
    }

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
 *   provider?: 'openai' | 'anthropic' | 'gemini'   default 'openai'
 */
export const agentOrchestratorNode: NodePlugin = {
  type: 'agentOrchestrator',
  async execute({ params, credential, workflowId, workspaceId, staticData, setStaticData }) {
    const provider = String(params.provider ?? 'openai');
    const sessionId = String(params.sessionId ?? `orchestrator-${Date.now()}`);
    const model = String(params.model ?? defaultModelFor(provider === 'anthropic' || provider === 'gemini' ? provider : 'openai'));
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
        params: { sessionId, model, provider, systemPrompt, prompt, tools, maxSteps: 6 },
        workflowId,
        workspaceId,
        staticData,
        setStaticData,
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
      subResults.push({ agent: step.agent, task: step.task, ...((result.output as Record<string, unknown>) ?? {}) });
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
          { stage: 'planner', ...((plannerResult.output as Record<string, unknown>) ?? {}) },
          ...subResults.map((r, i) => ({ stage: `subAgent:${plan[i]?.agent}`, ...r })),
          { stage: 'reviewer', ...((reviewResult.output as Record<string, unknown>) ?? {}) },
        ],
      },
    };
  },
};

registerNode(agentMemoryNode);
registerNode(agentNode);
registerNode(agentOrchestratorNode);