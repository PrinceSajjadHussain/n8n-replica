import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import type { VectorStore, VectorStoreEntry, ScoredEntry } from '../types';

/**
 * Weaviate adapter over its REST + GraphQL API (v1). One Weaviate "class"
 * per FlowForge namespace, created lazily. Uses BYO vectors (`vectorizer:
 * none`) since FlowForge always supplies its own embeddings.
 *
 * Config: WEAVIATE_URL (default http://localhost:8080), WEAVIATE_API_KEY (optional).
 */
export class WeaviateStore implements VectorStore {
  readonly name = 'weaviate';
  private client: AxiosInstance;
  private ensuredClasses = new Set<string>();

  constructor() {
    const url = process.env.WEAVIATE_URL || 'http://localhost:8080';
    const apiKey = process.env.WEAVIATE_API_KEY;
    this.client = axios.create({
      baseURL: url.replace(/\/$/, ''),
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      timeout: 30000,
    });
  }

  private className(namespace: string): string {
    // Weaviate class names must start with an uppercase letter, alphanumeric only.
    const safe = namespace.replace(/[^a-zA-Z0-9]/g, '_');
    return `Flowforge_${safe}`;
  }

  private uuid(id: string): string {
    const hash = crypto.createHash('md5').update(id).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  }

  private async ensureClass(namespace: string): Promise<string> {
    const cls = this.className(namespace);
    if (this.ensuredClasses.has(cls)) return cls;
    const exists = await this.client.get(`/v1/schema/${cls}`).then(() => true).catch(() => false);
    if (!exists) {
      await this.client.post('/v1/schema', {
        class: cls,
        vectorizer: 'none',
        properties: [
          { name: 'originalId', dataType: ['text'] },
          { name: 'text', dataType: ['text'] },
          { name: 'metadataJson', dataType: ['text'] },
        ],
      });
    }
    this.ensuredClasses.add(cls);
    return cls;
  }

  async upsert(namespace: string, entries: VectorStoreEntry[]): Promise<void> {
    const cls = await this.ensureClass(namespace);
    await this.client.post('/v1/batch/objects', {
      objects: entries.map((e) => ({
        class: cls,
        id: this.uuid(e.id),
        vector: e.embedding,
        properties: { originalId: e.id, text: e.text, metadataJson: JSON.stringify(e.metadata ?? {}) },
      })),
    });
  }

  async query(namespace: string, embedding: number[], topK: number, filter?: Record<string, unknown>): Promise<ScoredEntry[]> {
    const cls = await this.ensureClass(namespace);
    const where = filter && Object.keys(filter).length ? toWeaviateWhere(filter) : undefined;
    const gql = `{
      Get {
        ${cls}(nearVector: { vector: ${JSON.stringify(embedding)} }, limit: ${topK}${where ? `, where: ${where}` : ''}) {
          originalId text metadataJson
          _additional { certainty }
        }
      }
    }`;
    const res = await this.client.post('/v1/graphql', { query: gql });
    const rows = res.data?.data?.Get?.[cls] ?? [];
    return rows.map((r: any) => ({
      id: r.originalId,
      text: r.text,
      score: r._additional?.certainty ?? 0,
      metadata: safeParse(r.metadataJson),
    }));
  }

  async listAll(namespace: string, filter?: Record<string, unknown>): Promise<VectorStoreEntry[]> {
    const cls = await this.ensureClass(namespace);
    const where = filter && Object.keys(filter).length ? toWeaviateWhere(filter) : undefined;
    const entries: VectorStoreEntry[] = [];
    let after: string | undefined;
    do {
      const gql = `{
        Get {
          ${cls}(limit: 200${after ? `, after: "${after}"` : ''}${where ? `, where: ${where}` : ''}) {
            originalId text metadataJson
            _additional { id vector }
          }
        }
      }`;
      const res = await this.client.post('/v1/graphql', { query: gql });
      const rows = res.data?.data?.Get?.[cls] ?? [];
      for (const r of rows) {
        entries.push({ id: r.originalId, text: r.text, embedding: r._additional?.vector ?? [], metadata: safeParse(r.metadataJson) });
      }
      after = rows.length === 200 ? rows[rows.length - 1]?._additional?.id : undefined;
    } while (after);
    return entries;
  }

  async deleteNamespace(namespace: string): Promise<void> {
    const cls = this.className(namespace);
    await this.client.delete(`/v1/schema/${cls}`).catch(() => {});
    this.ensuredClasses.delete(cls);
  }
}

function toWeaviateWhere(filter: Record<string, unknown>): string {
  // Filters match against the JSON-encoded metadata blob via a simple
  // substring "Like" operator — Weaviate has no first-class JSON path
  // filtering without declaring every metadata key in the schema, so this
  // trades a little precision for keeping the schema free-form.
  const operands = Object.entries(filter).map(
    ([k, v]) => `{ path: ["metadataJson"], operator: Like, valueText: "*\\"${k}\\":\\"${String(v)}\\"*" }`
  );
  if (operands.length === 1) return operands[0];
  return `{ operator: And, operands: [${operands.join(',')}] }`;
}

function safeParse(json: string | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}
