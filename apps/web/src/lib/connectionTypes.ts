/**
 * Typed connection system — mirrors n8n's `NodeConnectionTypes` (packages/workflow/src/interfaces.ts).
 *
 * `main` is the regular data pipe drawn left/right between nodes. Every other
 * type is a "non-main" / sub-node connection (AI tool, model, memory, parser…)
 * drawn top/bottom, using a diamond handle instead of a dot, and can carry its
 * own `required` / `maxConnections` rules independent of the main pipe.
 *
 * A node's ports are NOT hardcoded into canvas/handle code — they're looked up
 * here by `nodeType` via `getNodePorts()`. Adding a new node type only means
 * adding (or omitting) an entry below; FlowNode + the handle components render
 * whatever comes back.
 */

export const NodeConnectionTypes = {
  Main: 'main',
  AiAgent: 'ai_agent',
  AiChain: 'ai_chain',
  AiDocument: 'ai_document',
  AiEmbedding: 'ai_embedding',
  AiLanguageModel: 'ai_languageModel',
  AiMemory: 'ai_memory',
  AiOutputParser: 'ai_outputParser',
  AiRetriever: 'ai_retriever',
  AiReranker: 'ai_reranker',
  AiTextSplitter: 'ai_textSplitter',
  AiTool: 'ai_tool',
  AiVectorStore: 'ai_vectorStore',
} as const;

export type NodeConnectionType = (typeof NodeConnectionTypes)[keyof typeof NodeConnectionTypes];

export type AiConnectionType = Exclude<NodeConnectionType, typeof NodeConnectionTypes.Main>;

export function isMainConnectionType(type: NodeConnectionType): type is typeof NodeConnectionTypes.Main {
  return type === NodeConnectionTypes.Main;
}

/** Human label + wire color per connection type, used by handles + edges. */
export const CONNECTION_TYPE_META: Record<NodeConnectionType, { label: string; color: string }> = {
  main: { label: '', color: 'var(--color-signal)' },
  ai_agent: { label: 'Agent', color: '#FF6B9D' },
  ai_chain: { label: 'Chain', color: '#FF6B9D' },
  ai_document: { label: 'Document', color: '#9B8AFB' },
  ai_embedding: { label: 'Embedding', color: '#4DB6E5' },
  ai_languageModel: { label: 'Model', color: '#9B8AFB' },
  ai_memory: { label: 'Memory', color: '#F5A742' },
  ai_outputParser: { label: 'Output Parser', color: '#6FCF97' },
  ai_retriever: { label: 'Retriever', color: '#4DB6E5' },
  ai_reranker: { label: 'Reranker', color: '#4DB6E5' },
  ai_textSplitter: { label: 'Text Splitter', color: '#9B8AFB' },
  ai_tool: { label: 'Tool', color: '#6FCF97' },
  ai_vectorStore: { label: 'Vector Store', color: '#4DB6E5' },
};

export interface NodePort {
  /** Handle id — unique within the node's inputs (or outputs). Used as the React Flow handle id. */
  id: string;
  type: NodeConnectionType;
  /** Overrides the connection type's default label (e.g. "true" / "false" on IF). */
  label?: string;
  required?: boolean;
  /** Undefined/0 = unlimited. 1 = single connection (most AI sub-inputs). */
  maxConnections?: number;
  category?: string;
}

export interface NodePorts {
  inputs: NodePort[];
  outputs: NodePort[];
}

const MAIN_IN: NodePort = { id: 'main-in', type: NodeConnectionTypes.Main };
const MAIN_OUT: NodePort = { id: 'main-out', type: NodeConnectionTypes.Main };
const DEFAULT_PORTS: NodePorts = { inputs: [MAIN_IN], outputs: [MAIN_OUT] };
const TRIGGER_PORTS: NodePorts = { inputs: [], outputs: [MAIN_OUT] };
const TERMINAL_PORTS: NodePorts = { inputs: [MAIN_IN], outputs: [] };

/** Node types with no main input (triggers). */
const TRIGGER_TYPES = new Set([
  'webhook',
  'schedule',
  'chatTrigger',
  'rssTrigger',
  'mqttTrigger',
  'formTrigger',
  'executeWorkflowTrigger',
]);

/** Node types with no main output (flow terminators). */
const TERMINAL_TYPES = new Set(['stopAndError', 'respondToWebhook']);

/** Explicit overrides for nodes whose port shape isn't the 1-in/1-out default. */
const PORTS_BY_NODE_TYPE: Record<string, NodePorts> = {
  if: {
    inputs: [MAIN_IN],
    outputs: [
      { id: 'true', type: NodeConnectionTypes.Main, label: 'true' },
      { id: 'false', type: NodeConnectionTypes.Main, label: 'false' },
    ],
  },
  switch: {
    inputs: [MAIN_IN],
    outputs: [
      { id: '0', type: NodeConnectionTypes.Main, label: '0' },
      { id: '1', type: NodeConnectionTypes.Main, label: '1' },
      { id: '2', type: NodeConnectionTypes.Main, label: '2' },
      { id: 'fallback', type: NodeConnectionTypes.Main, label: 'fallback' },
    ],
  },
  merge: {
    inputs: [
      { id: 'main-in-0', type: NodeConnectionTypes.Main, label: 'Input 1', required: true },
      { id: 'main-in-1', type: NodeConnectionTypes.Main, label: 'Input 2', required: true },
    ],
    outputs: [MAIN_OUT],
  },
  forEachBranch: {
    inputs: [MAIN_IN],
    outputs: [
      { id: 'loop', type: NodeConnectionTypes.Main, label: 'loop' },
      { id: 'done', type: NodeConnectionTypes.Main, label: 'done' },
    ],
  },
  noOp: DEFAULT_PORTS,
  stopAndError: TERMINAL_PORTS,
  respondToWebhook: TERMINAL_PORTS,

  // ---- AI: orchestrator nodes (main pipe + non-main sub-inputs on the bottom edge) ----
  agent: {
    inputs: [
      { id: 'main-in', type: NodeConnectionTypes.Main, required: true },
      { id: 'model', type: NodeConnectionTypes.AiLanguageModel, required: true, maxConnections: 1 },
      { id: 'memory', type: NodeConnectionTypes.AiMemory, maxConnections: 1 },
      { id: 'tool', type: NodeConnectionTypes.AiTool },
      { id: 'outputParser', type: NodeConnectionTypes.AiOutputParser, maxConnections: 1 },
    ],
    outputs: [MAIN_OUT],
  },
  agentOrchestrator: {
    inputs: [
      { id: 'main-in', type: NodeConnectionTypes.Main, required: true },
      { id: 'model', type: NodeConnectionTypes.AiLanguageModel, required: true, maxConnections: 1 },
      { id: 'agent', type: NodeConnectionTypes.AiAgent, required: true },
    ],
    outputs: [MAIN_OUT],
  },

  // ---- AI: chain-style nodes that need a model plugged in underneath ----
  textClassifier: {
    inputs: [
      { id: 'main-in', type: NodeConnectionTypes.Main, required: true },
      { id: 'model', type: NodeConnectionTypes.AiLanguageModel, required: true, maxConnections: 1 },
    ],
    outputs: [MAIN_OUT],
  },
  sentimentAnalysis: {
    inputs: [
      { id: 'main-in', type: NodeConnectionTypes.Main, required: true },
      { id: 'model', type: NodeConnectionTypes.AiLanguageModel, required: true, maxConnections: 1 },
    ],
    outputs: [MAIN_OUT],
  },
  entityExtractor: {
    inputs: [
      { id: 'main-in', type: NodeConnectionTypes.Main, required: true },
      { id: 'model', type: NodeConnectionTypes.AiLanguageModel, required: true, maxConnections: 1 },
    ],
    outputs: [MAIN_OUT],
  },
  summarizer: {
    inputs: [
      { id: 'main-in', type: NodeConnectionTypes.Main, required: true },
      { id: 'model', type: NodeConnectionTypes.AiLanguageModel, required: true, maxConnections: 1 },
    ],
    outputs: [MAIN_OUT],
  },
  qaChain: {
    inputs: [
      { id: 'main-in', type: NodeConnectionTypes.Main, required: true },
      { id: 'model', type: NodeConnectionTypes.AiLanguageModel, required: true, maxConnections: 1 },
      { id: 'retriever', type: NodeConnectionTypes.AiRetriever, maxConnections: 1 },
    ],
    outputs: [MAIN_OUT],
  },

  // ---- AI: RAG pipeline ----
  ragIngest: {
    inputs: [
      { id: 'main-in', type: NodeConnectionTypes.Main, required: true },
      { id: 'embedding', type: NodeConnectionTypes.AiEmbedding, required: true, maxConnections: 1 },
      { id: 'textSplitter', type: NodeConnectionTypes.AiTextSplitter, maxConnections: 1 },
      { id: 'vectorStore', type: NodeConnectionTypes.AiVectorStore, required: true, maxConnections: 1 },
    ],
    outputs: [MAIN_OUT],
  },
  ragQuery: {
    inputs: [
      { id: 'main-in', type: NodeConnectionTypes.Main, required: true },
      { id: 'embedding', type: NodeConnectionTypes.AiEmbedding, required: true, maxConnections: 1 },
      { id: 'vectorStore', type: NodeConnectionTypes.AiVectorStore, required: true, maxConnections: 1 },
    ],
    outputs: [MAIN_OUT],
  },

  // ---- AI: sub-node providers — no main pipe, just a non-main output plugged upward ----
  openai: { inputs: [], outputs: [{ id: 'model', type: NodeConnectionTypes.AiLanguageModel }] },
  anthropic: { inputs: [], outputs: [{ id: 'model', type: NodeConnectionTypes.AiLanguageModel }] },
  gemini: { inputs: [], outputs: [{ id: 'model', type: NodeConnectionTypes.AiLanguageModel }] },
  localLlm: { inputs: [], outputs: [{ id: 'model', type: NodeConnectionTypes.AiLanguageModel }] },
  groq: { inputs: [], outputs: [{ id: 'model', type: NodeConnectionTypes.AiLanguageModel }] },
  mistral: { inputs: [], outputs: [{ id: 'model', type: NodeConnectionTypes.AiLanguageModel }] },

  agentMemory: { inputs: [], outputs: [{ id: 'memory', type: NodeConnectionTypes.AiMemory }] },
  redisMemory: { inputs: [], outputs: [{ id: 'memory', type: NodeConnectionTypes.AiMemory }] },

  structuredOutputParser: { inputs: [], outputs: [{ id: 'outputParser', type: NodeConnectionTypes.AiOutputParser }] },
  autoFixingOutputParser: {
    inputs: [{ id: 'model', type: NodeConnectionTypes.AiLanguageModel, maxConnections: 1 }],
    outputs: [{ id: 'outputParser', type: NodeConnectionTypes.AiOutputParser }],
  },
};

/** Resolve a node type's declared inputs/outputs. Falls back to a plain 1-in/1-out main node. */
export function getNodePorts(nodeType: string | undefined): NodePorts {
  if (!nodeType) return DEFAULT_PORTS;
  if (PORTS_BY_NODE_TYPE[nodeType]) return PORTS_BY_NODE_TYPE[nodeType];
  if (TRIGGER_TYPES.has(nodeType)) return TRIGGER_PORTS;
  if (TERMINAL_TYPES.has(nodeType)) return TERMINAL_PORTS;
  return DEFAULT_PORTS;
}

export function isNonMain(type: NodeConnectionType): boolean {
  return type !== NodeConnectionTypes.Main;
}

/** Even-spread percentage offsets (5%..95%) for N ports sharing one edge of a node. */
export function spreadOffsets(count: number): number[] {
  if (count <= 1) return [50];
  const min = 18;
  const max = 82;
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => min + step * i);
}
