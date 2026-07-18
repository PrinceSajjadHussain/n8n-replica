import axios, { AxiosInstance } from 'axios';
import type { VectorStore, VectorStoreEntry, ScoredEntry } from '../types';

/**
 * Pinecone adapter. Talks to Pinecone's REST data-plane API directly
 * (rather than the @pinecone-database/pinecone SDK) so the integration
 * doesn't churn every time the SDK's method signatures change.
 *
 * Config:
 *   PINECONE_API_KEY  — required
 *   PINECONE_HOST      — required; the index host shown in the Pinecone
 *                         console (e.g. https://my-index-abc123.svc.us-east1-aws.pinecone.io)
 *
 * FlowForge's `namespace` maps 1:1 to a Pinecone namespace inside the
 * single configured index/host.
 */
export class PineconeStore implements VectorStore {
  readonly name = 'pinecone';
  private client: AxiosInstance;

  constructor() {
    const apiKey = process.env.PINECONE_API_KEY;
    const host = process.env.PINECONE_HOST;
    if (!apiKey || !host) throw new Error('pinecone store: set PINECONE_API_KEY and PINECONE_HOST (from the Pinecone console).');
    this.client = axios.create({
      baseURL: host.replace(/\/$/, ''),
      headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json', 'X-Pinecone-API-Version': '2024-07' },
      timeout: 30000,
    });
  }

  async upsert(namespace: string, entries: VectorStoreEntry[]): Promise<void> {
    await this.client.post('/vectors/upsert', {
      namespace,
      vectors: entries.map((e) => ({ id: e.id, values: e.embedding, metadata: { text: e.text, ...e.metadata } })),
    });
  }

  async query(namespace: string, embedding: number[], topK: number, filter?: Record<string, unknown>): Promise<ScoredEntry[]> {
    const res = await this.client.post('/query', {
      namespace,
      vector: embedding,
      topK,
      includeMetadata: true,
      filter: filter && Object.keys(filter).length ? toPineconeFilter(filter) : undefined,
    });
    return (res.data.matches ?? []).map((m: any) => ({
      id: m.id,
      text: m.metadata?.text ?? '',
      score: m.score,
      metadata: stripTextKey(m.metadata ?? {}),
    }));
  }

  async listAll(namespace: string, filter?: Record<string, unknown>): Promise<VectorStoreEntry[]> {
    // Pinecone's data-plane API has no "list all vectors with values" call
    // for pod-free (serverless) indexes; fetch via the list+fetch pair,
    // which returns embeddings for BM25/hybrid scoring.
    const ids: string[] = [];
    let paginationToken: string | undefined;
    do {
      const res = await this.client.get('/vectors/list', { params: { namespace, paginationToken, limit: 100 } });
      ids.push(...(res.data.vectors ?? []).map((v: any) => v.id));
      paginationToken = res.data.pagination?.next;
    } while (paginationToken);

    if (ids.length === 0) return [];
    const entries: VectorStoreEntry[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const res = await this.client.get('/vectors/fetch', { params: { namespace, ids: batch } });
      for (const [id, v] of Object.entries(res.data.vectors ?? {}) as [string, any][]) {
        const metadata = stripTextKey(v.metadata ?? {});
        if (!matchesLocalFilter(metadata, filter)) continue;
        entries.push({ id, text: v.metadata?.text ?? '', embedding: v.values, metadata });
      }
    }
    return entries;
  }

  async deleteNamespace(namespace: string): Promise<void> {
    await this.client.post('/vectors/delete', { namespace, deleteAll: true });
  }
}

function toPineconeFilter(filter: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filter)) out[k] = Array.isArray(v) ? { $in: v } : { $eq: v };
  return out;
}

function matchesLocalFilter(metadata: Record<string, unknown>, filter?: Record<string, unknown>): boolean {
  if (!filter) return true;
  return Object.entries(filter).every(([k, v]) => (Array.isArray(v) ? v.includes(metadata[k]) : metadata[k] === v));
}

function stripTextKey(metadata: Record<string, unknown>): Record<string, unknown> {
  const { text: _text, ...rest } = metadata;
  return rest;
}
