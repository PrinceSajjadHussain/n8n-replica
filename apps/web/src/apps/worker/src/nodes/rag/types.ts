/**
 * FlowForge RAG subsystem — shared types.
 *
 * A "chunk" is the unit that gets embedded and stored. Metadata is a free
 * JSON bag so every loader/chunker can stamp provenance (source, url,
 * page, docId, headerPath, row index, ...) that later powers metadata
 * filtering and the citation viewer.
 */

export interface LoadedDocument {
  /** Plain-text content extracted from the source. */
  text: string;
  /** Provenance metadata — merged into every chunk produced from this document. */
  meta: Record<string, unknown>;
}

export interface Chunk {
  text: string;
  /** Per-chunk metadata (docId, chunkIndex, headerPath, startChar, ...) merged with the parent document's meta. */
  meta: Record<string, unknown>;
}

export interface VectorStoreEntry {
  id: string;
  text: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

export interface ScoredEntry {
  id: string;
  text: string;
  score: number;
  metadata: Record<string, unknown>;
}

/**
 * A pluggable vector store backend. Implementations: json (default,
 * zero-infra), pgvector, pinecone, qdrant, weaviate. Selected via the
 * `vectorStore` node param or RAG_VECTOR_STORE env var.
 */
export interface VectorStore {
  readonly name: string;
  upsert(namespace: string, entries: VectorStoreEntry[]): Promise<void>;
  /** Nearest-neighbour vector search. `filter` is an exact-match metadata filter (AND of all keys). */
  query(namespace: string, embedding: number[], topK: number, filter?: Record<string, unknown>): Promise<ScoredEntry[]>;
  /** Returns every entry in the namespace — used for BM25 keyword scoring when the backend has no native full-text search. */
  listAll(namespace: string, filter?: Record<string, unknown>): Promise<VectorStoreEntry[]>;
  deleteNamespace(namespace: string): Promise<void>;
}

export function matchesFilter(metadata: Record<string, unknown>, filter?: Record<string, unknown>): boolean {
  if (!filter) return true;
  return Object.entries(filter).every(([k, v]) => {
    const actual = metadata[k];
    if (Array.isArray(v)) return v.includes(actual);
    return actual === v;
  });
}
