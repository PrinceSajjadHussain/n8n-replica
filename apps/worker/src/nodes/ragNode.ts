import axios from 'axios';
import { registerNode } from './types';
import type { NodePlugin } from './types';
import type { NodeItems, BinaryCollection, NodeItem } from '@flowforge/shared-types';
import type { LoadedDocument } from './rag/types';
import { chunkDocument, type ChunkingOptions } from './rag/chunking';
import {
  loadFromBinary,
  loadPlainText,
  crawlWebsite,
  loadGoogleDriveFile,
  loadNotionPage,
  loadConfluencePage,
} from './rag/loaders';
import { getVectorStore } from './rag/stores';
import { bm25Search, reciprocalRankFusion } from './rag/keywordSearch';
import { rerank, type RerankProvider } from './rag/rerank';
import type { ScoredEntry } from './rag/types';

/**
 * Production-grade RAG (Retrieval Augmented Generation).
 *
 * ragIngest — real document loaders (PDF/DOCX/CSV/HTML/website crawl/
 * Google Drive/Notion/Confluence, or raw text/binary passthrough), smart
 * chunking (fixed/token-aware/markdown-aware/semantic), embeds, and
 * upserts into a pluggable vector store (json/pgvector/pinecone/qdrant/
 * weaviate — see rag/stores).
 *
 * ragQuery — hybrid search (BM25 keyword + vector via Reciprocal Rank
 * Fusion), optional reranking (Cohere or LLM-based), metadata filtering,
 * and a citation-ready result shape for the web app's citation viewer.
 */

async function embed(apiKey: string, texts: string[]): Promise<number[][]> {
  const response = await axios.post(
    'https://api.openai.com/v1/embeddings',
    { model: 'text-embedding-3-small', input: texts },
    { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 60000 }
  );
  return response.data.data.map((d: { embedding: number[] }) => d.embedding);
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Resolves the set of LoadedDocument's for an ingest call from whichever
 * `source` was configured, and (when relevant) from binary/text carried
 * on the upstream items themselves.
 */
async function resolveDocuments(
  params: Record<string, unknown>,
  items: NodeItems,
  credential: Record<string, unknown> | null,
  getBinary: (item: any, key?: string) => Buffer | null
): Promise<LoadedDocument[]> {
  const source = String(params.source ?? 'auto');

  if (source === 'text') {
    const raw = params.documents ?? params.text;
    const docs: string[] = Array.isArray(raw) ? raw.map(String) : [String(raw ?? '')];
    return docs.flatMap((d) => loadPlainText(d));
  }

  if (source === 'url') {
    const url = String(params.url ?? '');
    if (!url) throw new Error('ragIngest: source "url" requires params.url');
    const res = await axios.get(url, { timeout: 20000, headers: { 'User-Agent': 'FlowForgeRAGBot/1.0' } });
    const contentType = String(res.headers['content-type'] ?? '');
    if (contentType.includes('html')) {
      const { loadHtml } = await import('./rag/loaders');
      return loadHtml(String(res.data), url);
    }
    return loadPlainText(typeof res.data === 'string' ? res.data : JSON.stringify(res.data), { sourceType: 'url', url });
  }

  if (source === 'website') {
    const website = (params.website ?? {}) as { startUrl?: string; maxPages?: number; sameDomainOnly?: boolean };
    if (!website.startUrl) throw new Error('ragIngest: source "website" requires params.website.startUrl');
    return crawlWebsite({ startUrl: website.startUrl, maxPages: website.maxPages, sameDomainOnly: website.sameDomainOnly });
  }

  if (source === 'googleDrive') {
    const accessToken = credential?.accessToken as string;
    if (!accessToken) throw new Error('ragIngest: source "googleDrive" requires a "google" credential with { accessToken }.');
    const gd = (params.googleDrive ?? {}) as { fileId?: string };
    if (!gd.fileId) throw new Error('ragIngest: source "googleDrive" requires params.googleDrive.fileId');
    return loadGoogleDriveFile(accessToken, gd.fileId);
  }

  if (source === 'notion') {
    const apiKey = credential?.apiKey as string;
    if (!apiKey) throw new Error('ragIngest: source "notion" requires a "notion" credential with { apiKey }.');
    const notion = (params.notion ?? {}) as { pageId?: string };
    if (!notion.pageId) throw new Error('ragIngest: source "notion" requires params.notion.pageId');
    return loadNotionPage(apiKey, notion.pageId);
  }

  if (source === 'confluence') {
    const email = credential?.email as string;
    const apiToken = credential?.apiToken as string;
    if (!email || !apiToken) throw new Error('ragIngest: source "confluence" requires a "confluence" credential with { email, apiToken }.');
    const conf = (params.confluence ?? {}) as { baseUrl?: string; pageId?: string };
    if (!conf.baseUrl || !conf.pageId) throw new Error('ragIngest: source "confluence" requires params.confluence.{baseUrl,pageId}');
    return loadConfluencePage(conf.baseUrl, email, apiToken, conf.pageId);
  }

  if (source === 'binary') {
    const docs: LoadedDocument[] = [];
    for (const item of items) {
      for (const key of Object.keys(item.binary ?? {})) {
        const buf = getBinary(item, key);
        const bin = item.binary![key];
        if (buf) docs.push(...(await loadFromBinary(buf, bin.mimeType, bin.fileName)));
      }
    }
    return docs;
  }

  // auto: prefer binary attachments on the incoming items, then explicit
  // documents/text params, then the raw item JSON stringified.
  const binaryDocs: LoadedDocument[] = [];
  for (const item of items) {
    const binCol: BinaryCollection | undefined = item.binary as BinaryCollection | undefined;
    for (const key of Object.keys(binCol ?? {})) {
      const buf = getBinary(item, key);
      const bin = binCol![key];
      if (buf) binaryDocs.push(...(await loadFromBinary(buf, bin.mimeType, bin.fileName)));
    }
  }
  if (binaryDocs.length) return binaryDocs;

  if (params.documents || params.text) {
    const raw = params.documents ?? params.text;
    const docs: string[] = Array.isArray(raw) ? raw.map(String) : [String(raw)];
    return docs.flatMap((d) => loadPlainText(d));
  }

  return items.map((item: NodeItem) => ({ text: JSON.stringify(item.json), meta: { sourceType: 'item' } }));
}

export const ragIngestNode: NodePlugin = {
  type: 'ragIngest',
  async execute({ items, params, credential, getBinary }) {
    const apiKey = (credential?.apiKey as string) ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('ragIngest node: requires an "openai" credential with apiKey (used for embeddings).');

    const namespace = String(params.namespace ?? 'default');
    const docs = await resolveDocuments(params, items, credential, getBinary);
    if (docs.length === 0) return { output: { ingested: 0, namespace } };

    const extraMeta = (params.metadata ?? {}) as Record<string, unknown>;
    const docsWithMeta = docs.map((d, i) => ({ ...d, meta: { ...d.meta, docId: `${namespace}-${Date.now()}-${i}`, ...extraMeta } }));

    const chunkingParams = (params.chunking ?? {}) as Partial<ChunkingOptions>;
    const chunkingOpts: ChunkingOptions = { strategy: (chunkingParams.strategy as ChunkingOptions['strategy']) ?? 'token', ...chunkingParams };

    const embedFn = (texts: string[]) => embed(apiKey, texts);
    const allChunks = (await Promise.all(docsWithMeta.map((d) => chunkDocument(d, chunkingOpts, embedFn)))).flat();
    if (allChunks.length === 0) return { output: { ingested: 0, namespace } };

    // Batch embeddings (OpenAI accepts up to ~2048 inputs/call; chunk into 200s to stay well under request-size limits).
    const embeddings: number[][] = [];
    for (let i = 0; i < allChunks.length; i += 200) {
      const batch = allChunks.slice(i, i + 200).map((c) => c.text);
      embeddings.push(...(await embedFn(batch)));
    }

    const store = getVectorStore(params.vectorStore as string | undefined);
    await store.upsert(
      namespace,
      allChunks.map((c, i) => ({ id: newId(), text: c.text, embedding: embeddings[i], metadata: c.meta }))
    );

    return {
      output: {
        ingested: allChunks.length,
        documents: docs.length,
        namespace,
        vectorStore: store.name,
        chunkingStrategy: chunkingOpts.strategy,
      },
    };
  },
};

function toCitations(matches: ScoredEntry[]) {
  return matches.map((m, i) => ({
    n: i + 1,
    id: m.id,
    score: m.score,
    text: m.text,
    snippet: m.text.length > 280 ? `${m.text.slice(0, 280)}…` : m.text,
    source: m.metadata?.fileName ?? m.metadata?.url ?? m.metadata?.title ?? m.metadata?.sourceType ?? 'document',
    metadata: m.metadata,
  }));
}

export const ragQueryNode: NodePlugin = {
  type: 'ragQuery',
  async execute({ input, params, credential }) {
    const apiKey = (credential?.apiKey as string) ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('ragQuery node: requires an "openai" credential with apiKey.');

    const namespace = String(params.namespace ?? 'default');
    const query = String(params.query ?? (typeof input === 'string' ? input : JSON.stringify(input ?? '')));
    const topK = Number(params.topK ?? 4);
    const filter = params.filter as Record<string, unknown> | undefined;
    const useHybrid = params.hybrid !== false; // default true

    const store = getVectorStore(params.vectorStore as string | undefined);
    const candidatePool = Math.max(topK * 5, 20);

    const [queryEmbedding] = await embed(apiKey, [query]);
    const vectorMatches = await store.query(namespace, queryEmbedding, candidatePool, filter);

    if (vectorMatches.length === 0) {
      return {
        output: {
          matches: [],
          citations: [],
          answer: null,
          note: `namespace "${namespace}" is empty or has no matches — run ragIngest first`,
        },
      };
    }

    let fused: ScoredEntry[] = vectorMatches;
    if (useHybrid) {
      const corpus = await store.listAll(namespace, filter);
      const keywordMatches = bm25Search(query, corpus, candidatePool);
      fused = reciprocalRankFusion([vectorMatches, keywordMatches]);
    }

    const rerankOpts = (params.rerank ?? { provider: 'none' }) as { provider?: RerankProvider; topN?: number };
    const reranked = await rerank(rerankOpts.provider ?? 'none', query, fused, rerankOpts.topN ?? topK, {
      cohereApiKey: (credential?.cohereApiKey as string) ?? process.env.COHERE_API_KEY,
      openaiApiKey: apiKey,
      model: params.rerankModel as string | undefined,
    });

    const finalMatches = reranked.slice(0, topK);
    const citations = toCitations(finalMatches);

    let answer: string | null = null;
    if (params.answerWithModel) {
      const context = citations.map((c) => `[${c.n}] (source: ${c.source}) ${c.text}`).join('\n\n');
      const chat = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: String(params.model ?? 'gpt-4o-mini'),
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content:
                'Answer the user question using ONLY the provided numbered context passages. Cite sources inline like [1], [2]. If the answer is not in the context, say so plainly.',
            },
            { role: 'user', content: `Context:\n${context}\n\nQuestion: ${query}` },
          ],
        },
        { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 60000 }
      );
      answer = chat.data.choices?.[0]?.message?.content ?? null;
    }

    return {
      output: {
        matches: finalMatches,
        citations,
        answer,
        namespace,
        vectorStore: store.name,
        hybrid: useHybrid,
        reranked: (rerankOpts.provider ?? 'none') !== 'none',
      },
    };
  },
};

registerNode(ragIngestNode);
registerNode(ragQueryNode);
