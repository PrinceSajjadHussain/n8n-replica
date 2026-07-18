import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import type { VectorStore, VectorStoreEntry, ScoredEntry } from '../types';

/**
 * Qdrant adapter over its REST API. One Qdrant "collection" per FlowForge
 * namespace (collections are created lazily on first upsert).
 *
 * Config: QDRANT_URL (default http://localhost:6333), QDRANT_API_KEY
 * (optional, for Qdrant Cloud), RAG_QDRANT_DIM (embedding dimension,
 * default 1536).
 */
export class QdrantStore implements VectorStore {
  readonly name = 'qdrant';
  private client: AxiosInstance;
  private dim: number;
  private ensuredCollections = new Set<string>();

  constructor() {
    const url = process.env.QDRANT_URL || 'http://localhost:6333';
    const apiKey = process.env.QDRANT_API_KEY;
    this.dim = Number(process.env.RAG_QDRANT_DIM ?? 1536);
    this.client = axios.create({
      baseURL: url.replace(/\/$/, ''),
      headers: apiKey ? { 'api-key': apiKey } : undefined,
      timeout: 30000,
    });
  }

  private collectionName(namespace: string): string {
    return `flowforge_${namespace.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  }

  /** Qdrant point IDs must be UUID or unsigned int — map FlowForge's arbitrary string ids deterministically. */
  private pointId(id: string): string {
    return crypto.createHash('md5').update(id).digest('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
  }

  private async ensureCollection(namespace: string): Promise<string> {
    const name = this.collectionName(namespace);
    if (this.ensuredCollections.has(name)) return name;
    const exists = await this.client.get(`/collections/${name}`).then(() => true).catch(() => false);
    if (!exists) {
      await this.client.put(`/collections/${name}`, { vectors: { size: this.dim, distance: 'Cosine' } });
    }
    this.ensuredCollections.add(name);
    return name;
  }

  async upsert(namespace: string, entries: VectorStoreEntry[]): Promise<void> {
    const name = await this.ensureCollection(namespace);
    await this.client.put(`/collections/${name}/points`, {
      points: entries.map((e) => ({
        id: this.pointId(e.id),
        vector: e.embedding,
        payload: { originalId: e.id, text: e.text, ...e.metadata },
      })),
    });
  }

  async query(namespace: string, embedding: number[], topK: number, filter?: Record<string, unknown>): Promise<ScoredEntry[]> {
    const name = await this.ensureCollection(namespace);
    const res = await this.client.post(`/collections/${name}/points/search`, {
      vector: embedding,
      limit: topK,
      with_payload: true,
      filter: filter && Object.keys(filter).length ? toQdrantFilter(filter) : undefined,
    });
    return (res.data.result ?? []).map((r: any) => ({
      id: r.payload?.originalId ?? String(r.id),
      text: r.payload?.text ?? '',
      score: r.score,
      metadata: stripKeys(r.payload ?? {}),
    }));
  }

  async listAll(namespace: string, filter?: Record<string, unknown>): Promise<VectorStoreEntry[]> {
    const name = await this.ensureCollection(namespace);
    const entries: VectorStoreEntry[] = [];
    let offset: string | number | undefined;
    do {
      const res = await this.client.post(`/collections/${name}/points/scroll`, {
        limit: 200,
        offset,
        with_payload: true,
        with_vector: true,
        filter: filter && Object.keys(filter).length ? toQdrantFilter(filter) : undefined,
      });
      for (const p of res.data.result?.points ?? []) {
        entries.push({
          id: p.payload?.originalId ?? String(p.id),
          text: p.payload?.text ?? '',
          embedding: p.vector,
          metadata: stripKeys(p.payload ?? {}),
        });
      }
      offset = res.data.result?.next_page_offset ?? undefined;
    } while (offset);
    return entries;
  }

  async deleteNamespace(namespace: string): Promise<void> {
    const name = this.collectionName(namespace);
    await this.client.delete(`/collections/${name}`).catch(() => {});
    this.ensuredCollections.delete(name);
  }
}

function toQdrantFilter(filter: Record<string, unknown>) {
  return { must: Object.entries(filter).map(([key, value]) => ({ key, match: Array.isArray(value) ? { any: value } : { value } })) };
}

function stripKeys(payload: Record<string, unknown>): Record<string, unknown> {
  const { originalId: _o, text: _t, ...rest } = payload;
  return rest;
}
