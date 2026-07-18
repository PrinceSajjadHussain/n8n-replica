import fs from 'fs';
import path from 'path';
import type { VectorStore, VectorStoreEntry, ScoredEntry } from '../types';
import { matchesFilter } from '../types';

const STORE_DIR = process.env.RAG_STORE_DIR ?? '/tmp/flowforge-rag';

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
 * Default vector store: one JSON file per namespace on local disk. Zero
 * extra infrastructure so FlowForge runs out of the box, but it's O(n)
 * brute-force cosine search and not durable/shared across workers — use
 * pgvector/Pinecone/Qdrant/Weaviate for production.
 */
export class JsonVectorStore implements VectorStore {
  readonly name = 'json';

  private storePath(namespace: string) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    const safe = namespace.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(STORE_DIR, `${safe}.json`);
  }

  private read(namespace: string): VectorStoreEntry[] {
    const p = this.storePath(namespace);
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  }

  private write(namespace: string, entries: VectorStoreEntry[]) {
    fs.writeFileSync(this.storePath(namespace), JSON.stringify(entries));
  }

  async upsert(namespace: string, entries: VectorStoreEntry[]): Promise<void> {
    const existing = this.read(namespace);
    const byId = new Map(existing.map((e) => [e.id, e]));
    for (const e of entries) byId.set(e.id, e);
    this.write(namespace, Array.from(byId.values()));
  }

  async query(namespace: string, embedding: number[], topK: number, filter?: Record<string, unknown>): Promise<ScoredEntry[]> {
    const entries = this.read(namespace).filter((e) => matchesFilter(e.metadata, filter));
    return entries
      .map((e) => ({ id: e.id, text: e.text, score: cosineSim(embedding, e.embedding), metadata: e.metadata }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async listAll(namespace: string, filter?: Record<string, unknown>): Promise<VectorStoreEntry[]> {
    return this.read(namespace).filter((e) => matchesFilter(e.metadata, filter));
  }

  async deleteNamespace(namespace: string): Promise<void> {
    const p = this.storePath(namespace);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
