import { Pool } from 'pg';
import type { VectorStore, VectorStoreEntry, ScoredEntry } from '../types';

/**
 * pgvector-backed store. Requires the `vector` extension
 * (`CREATE EXTENSION IF NOT EXISTS vector;` — this store issues that
 * itself, so the DB role just needs privileges to do so once).
 *
 * Config: RAG_PGVECTOR_URL (falls back to DATABASE_URL) and
 * RAG_PGVECTOR_DIM (embedding dimension, default 1536 — matches
 * OpenAI's text-embedding-3-small).
 */
export class PgVectorStore implements VectorStore {
  readonly name = 'pgvector';
  private pool: Pool;
  private dim: number;
  private ready: Promise<void> | null = null;

  constructor() {
    const connectionString = process.env.RAG_PGVECTOR_URL || process.env.DATABASE_URL;
    if (!connectionString) throw new Error('pgvector store: set RAG_PGVECTOR_URL (or DATABASE_URL) to a Postgres connection string.');
    this.pool = new Pool({ connectionString });
    this.dim = Number(process.env.RAG_PGVECTOR_DIM ?? 1536);
  }

  private async ensureSchema(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS rag_chunks (
            id TEXT NOT NULL,
            namespace TEXT NOT NULL,
            text TEXT NOT NULL,
            embedding VECTOR(${this.dim}) NOT NULL,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (namespace, id)
          )
        `);
        await this.pool.query('CREATE INDEX IF NOT EXISTS rag_chunks_namespace_idx ON rag_chunks (namespace)');
        await this.pool.query(
          `CREATE INDEX IF NOT EXISTS rag_chunks_embedding_idx ON rag_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`
        ).catch(() => {
          // ivfflat requires ANALYZE'd data / non-empty table on some pg versions — safe to skip, brute force still works.
        });
      })();
    }
    return this.ready;
  }

  private toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }

  private buildFilterClause(filter: Record<string, unknown> | undefined, paramOffset: number): { clause: string; params: unknown[] } {
    if (!filter || Object.keys(filter).length === 0) return { clause: '', params: [] };
    const clauses: string[] = [];
    const params: unknown[] = [];
    let i = paramOffset;
    for (const [key, value] of Object.entries(filter)) {
      clauses.push(`metadata->>'${key.replace(/'/g, "''")}' = $${i}`);
      params.push(String(value));
      i += 1;
    }
    return { clause: ` AND ${clauses.join(' AND ')}`, params };
  }

  async upsert(namespace: string, entries: VectorStoreEntry[]): Promise<void> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const e of entries) {
        await client.query(
          `INSERT INTO rag_chunks (id, namespace, text, embedding, metadata)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (namespace, id) DO UPDATE SET text = EXCLUDED.text, embedding = EXCLUDED.embedding, metadata = EXCLUDED.metadata`,
          [e.id, namespace, e.text, this.toVectorLiteral(e.embedding), JSON.stringify(e.metadata ?? {})]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async query(namespace: string, embedding: number[], topK: number, filter?: Record<string, unknown>): Promise<ScoredEntry[]> {
    await this.ensureSchema();
    const { clause, params } = this.buildFilterClause(filter, 4);
    const res = await this.pool.query<{ id: string; text: string; score: string; metadata: Record<string, unknown> }>(
      `SELECT id, text, metadata, 1 - (embedding <=> $1) AS score
       FROM rag_chunks
       WHERE namespace = $2 ${clause}
       ORDER BY embedding <=> $1
       LIMIT $3`,
      [this.toVectorLiteral(embedding), namespace, topK, ...params]
    );
    return res.rows.map((r) => ({ id: r.id, text: r.text, score: Number(r.score), metadata: r.metadata }));
  }

  async listAll(namespace: string, filter?: Record<string, unknown>): Promise<VectorStoreEntry[]> {
    await this.ensureSchema();
    const { clause, params } = this.buildFilterClause(filter, 2);
    const res = await this.pool.query<{ id: string; text: string; embedding: string; metadata: Record<string, unknown> }>(
      `SELECT id, text, embedding, metadata FROM rag_chunks WHERE namespace = $1 ${clause}`,
      [namespace, ...params]
    );
    return res.rows.map((r) => ({
      id: r.id,
      text: r.text,
      embedding: parsePgVector(r.embedding),
      metadata: r.metadata,
    }));
  }

  async deleteNamespace(namespace: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query('DELETE FROM rag_chunks WHERE namespace = $1', [namespace]);
  }
}

function parsePgVector(value: unknown): number[] {
  if (Array.isArray(value)) return value as number[];
  if (typeof value === 'string') return value.replace(/[[\]]/g, '').split(',').map(Number);
  return [];
}
