import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * SUB-NODE CONFIG PROVIDERS
 * =========================
 * These four node types exist purely so the "Embedding" / "Text Splitter" /
 * "Vector Store" / "Tool" sub-input ports on ragIngest, ragQuery, and agent
 * (see connectionTypes.ts's PORTS_BY_NODE_TYPE) have something real to plug
 * into — previously NO node type declared these outputs at all, so the
 * "Pick a node to plug into Embedding/Text Splitter/Vector Store/Tool"
 * picker always came back empty.
 *
 * Like `openai`/`gemini`/`redisMemory` (the existing sub-node providers),
 * these have no main pipe — dropping one on the canvas and running it just
 * echoes back its own configured params as output. The real behavior comes
 * from the executor (`apps/worker/src/engine/executor.ts`), which — for any
 * node with non-main incoming edges — collects each connected sub-node's
 * output keyed by the target handle id into `params.$subNodes`, which
 * `ragNode.ts` / `agentNode.ts` read to override their embedding provider,
 * chunking strategy, vector store, and tool list respectively.
 */

export const embeddingProviderNode: NodePlugin = {
  type: 'embeddingProvider',
  async execute({ params }) {
    return { output: { provider: String(params.provider ?? 'openai') } };
  },
};

export const textSplitterConfigNode: NodePlugin = {
  type: 'textSplitterConfig',
  async execute({ params }) {
    return {
      output: {
        strategy: String(params.strategy ?? 'fixed'),
        chunkSize: Number(params.chunkSize ?? 1000),
        chunkOverlap: Number(params.chunkOverlap ?? 200),
      },
    };
  },
};

export const vectorStoreConfigNode: NodePlugin = {
  type: 'vectorStoreConfig',
  async execute({ params }) {
    return {
      output: {
        store: String(params.store ?? 'json'),
        namespace: String(params.namespace ?? 'default'),
      },
    };
  },
};

export const agentToolNode: NodePlugin = {
  type: 'agentTool',
  async execute({ params }) {
    const parseJsonField = (v: unknown): Record<string, unknown> => {
      try {
        return typeof v === 'string' ? JSON.parse(v || '{}') : ((v as Record<string, unknown>) ?? {});
      } catch {
        return {};
      }
    };
    return {
      output: {
        name: String(params.name ?? 'tool'),
        description: String(params.description ?? ''),
        nodeType: String(params.nodeType ?? 'httpRequest'),
        nodeParams: parseJsonField(params.nodeParams),
        parameters: parseJsonField(params.parameters),
      },
    };
  },
};

registerNode(embeddingProviderNode);
registerNode(textSplitterConfigNode);
registerNode(vectorStoreConfigNode);
registerNode(agentToolNode);