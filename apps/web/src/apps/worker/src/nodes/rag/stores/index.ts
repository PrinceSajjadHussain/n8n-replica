import type { VectorStore } from '../types';
import { JsonVectorStore } from './jsonStore';
import { PgVectorStore } from './pgvectorStore';
import { PineconeStore } from './pineconeStore';
import { QdrantStore } from './qdrantStore';
import { WeaviateStore } from './weaviateStore';

export type VectorStoreKind = 'json' | 'pgvector' | 'pinecone' | 'qdrant' | 'weaviate';

const instances: Partial<Record<VectorStoreKind, VectorStore>> = {};

/**
 * Resolves the vector store to use for a RAG node call: explicit `kind`
 * param wins, otherwise RAG_VECTOR_STORE env var, otherwise the
 * zero-infra JSON file store. Instances are cached (connection reuse).
 */
export function getVectorStore(kind?: string): VectorStore {
  const resolved = (kind || process.env.RAG_VECTOR_STORE || 'json') as VectorStoreKind;
  if (instances[resolved]) return instances[resolved]!;

  let store: VectorStore;
  switch (resolved) {
    case 'pgvector':
      store = new PgVectorStore();
      break;
    case 'pinecone':
      store = new PineconeStore();
      break;
    case 'qdrant':
      store = new QdrantStore();
      break;
    case 'weaviate':
      store = new WeaviateStore();
      break;
    case 'json':
    default:
      store = new JsonVectorStore();
      break;
  }
  instances[resolved] = store;
  return store;
}

export type { VectorStore, VectorStoreEntry, ScoredEntry } from '../types';
