# Production-grade RAG

The `ragIngest` and `ragQuery` nodes (`apps/worker/src/nodes/ragNode.ts` +
`apps/worker/src/nodes/rag/*`) implement retrieval-augmented generation
with real document loaders, smart chunking, pluggable vector databases,
and hybrid search with reranking and citations.

## Document loaders (`rag/loaders.ts`)

`ragIngest`'s `source` param selects how documents are pulled in:

| source | what it does | requires |
|---|---|---|
| `auto` (default) | Uses binary attached to upstream items if present (PDF/DOCX/CSV/HTML auto-detected by mime/extension), else `params.text`/`documents`, else the raw item JSON. | — |
| `binary` | Same binary auto-detection, explicit. | An upstream node producing binary (e.g. an HTTP Request node downloading a file). |
| `text` | Raw string(s) in `params.text` / `params.documents`. | — |
| `url` | Fetches one URL; HTML is stripped to text, everything else passed through as text. | — |
| `website` | Breadth-first crawl from `website.startUrl` (default `maxPages: 20`, `sameDomainOnly: true`), each page loaded via the HTML loader. | — |
| `googleDrive` | Exports native Docs/Sheets/Slides or downloads+parses uploaded PDF/DOCX/CSV files. `googleDrive.fileId`. | a `google` OAuth credential `{ accessToken }` |
| `notion` | Recursively flattens a page's blocks to text. `notion.pageId`. | a `notion` credential `{ apiKey }` |
| `confluence` | Fetches page storage-format body, strips to text. `confluence.{baseUrl,pageId}`. | a `confluence` credential `{ email, apiToken }` |

PDF (`pdf-parse`), DOCX (`mammoth`), CSV (`csv-parse`, one row = one
document with column metadata), and HTML (`cheerio`) are handled by
`loadFromBinary`, shared by every source above.

## Chunking (`rag/chunking.ts`)

`chunking.strategy`:

- **`fixed`** — original behaviour: fixed character window (`chunkSize`,
  `chunkOverlap`).
- **`token`** (default) — windows sized in actual embedding-model tokens
  (`maxTokens`, `overlapTokens`) via `gpt-tokenizer` (cl100k_base), so
  chunks reliably fit model limits regardless of language/script.
- **`markdown`** — splits on `#`/`##`/... heading boundaries first (so a
  chunk never straddles two sections), stamping a `headerPath` breadcrumb
  into each chunk's metadata; oversized sections are sub-split
  token-aware.
- **`semantic`** — splits into sentences, embeds each one, and merges
  consecutive sentences whose cosine similarity stays above
  `breakpointThreshold` (default 0.25 distance) into one chunk, so
  boundaries land where the topic actually shifts rather than at an
  arbitrary size. Bounded by `semanticMaxTokens` so one run can't grow
  unbounded. Costs one extra embedding call per sentence at ingest time.

## Vector stores (`rag/stores/`)

Selected via the `vectorStore` node param or `RAG_VECTOR_STORE` env var:
`json` (default), `pgvector`, `pinecone`, `qdrant`, `weaviate`. All
implement the same `VectorStore` interface (`upsert`/`query`/`listAll`/
`deleteNamespace`), so nodes and the hybrid-search layer are backend
agnostic. See `.env.example` for each backend's connection config.

- **json** — one JSON file per namespace on local disk. Zero infra, not
  durable/shared across workers — dev/small-scale only.
- **pgvector** — raw SQL over `pg`; creates the `vector` extension and a
  `rag_chunks` table (with an `ivfflat` cosine index) on first use.
- **pinecone** — talks to Pinecone's REST data-plane API directly (not
  the SDK) so it doesn't churn with SDK version bumps.
- **qdrant** — REST API; one Qdrant collection per FlowForge namespace,
  created lazily.
- **weaviate** — REST + GraphQL API; one class per namespace,
  `vectorizer: none` since FlowForge always supplies its own embeddings.

## Hybrid search, reranking, filtering, citations (`ragQuery`)

- **Hybrid search** (`hybrid: true`, default): vector search (from the
  configured store) and BM25 keyword search (`rag/keywordSearch.ts`, run
  in-process over `listAll()` so it works uniformly across every
  backend) are fused with Reciprocal Rank Fusion — no score
  normalization needed across the two very different scales.
- **Metadata filtering** (`filter: { ... }`): exact-match (or `{ field:
  [...] }` "in") filter applied at the store level, against whatever
  metadata the ingest step stamped (`fileName`, `sourceType`, `docId`,
  `headerPath`, CSV `row`, custom `metadata` passed to `ragIngest`, ...).
- **Reranking** (`rerank: { provider, topN }`): `"cohere"` calls the real
  Cohere Rerank cross-encoder API (`cohere` credential or
  `COHERE_API_KEY`); `"llm"` is a fallback that asks the node's `openai`
  credential to score each candidate 0–10 in one batched call when no
  dedicated reranker key is configured; `"none"` (default) skips this
  step.
- **Citations**: every response includes `citations: [{ n, source,
  snippet, score, metadata }]`, and `answer` (when `answerWithModel:
  true`) is prompted to cite `[n]` inline against those exact passages.
  `apps/web/src/components/CitationViewer.tsx` renders this in the
  Execution History view — the answer with clickable `[n]` markers
  followed by the numbered source list.

## Example

```json
// ragIngest
{
  "namespace": "handbook",
  "source": "website",
  "website": { "startUrl": "https://docs.example.com", "maxPages": 50 },
  "chunking": { "strategy": "markdown", "maxTokens": 300 },
  "vectorStore": "pgvector"
}
```

```json
// ragQuery
{
  "namespace": "handbook",
  "query": "how do I reset a password?",
  "topK": 4,
  "hybrid": true,
  "filter": { "sourceType": "html" },
  "rerank": { "provider": "cohere", "topN": 4 },
  "answerWithModel": true,
  "vectorStore": "pgvector"
}
```
