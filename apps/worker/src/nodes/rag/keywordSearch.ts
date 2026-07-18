import type { ScoredEntry, VectorStoreEntry } from './types';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'to', 'of', 'in', 'on', 'for', 'with',
  'as', 'by', 'at', 'from', 'that', 'this', 'it', 'its', 'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they', 'do', 'does',
  'did', 'not', 'no', 'so', 'if', 'than', 'then', 'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

/**
 * Classic BM25 (k1=1.5, b=0.75) scored over the full corpus passed in.
 * Kept in-process/in-memory: it's called against `listAll()` from the
 * active vector store, so it works uniformly whether the backend is the
 * JSON file store or a hosted vector DB with no native full-text index.
 */
export function bm25Search(query: string, corpus: VectorStoreEntry[], topK: number): ScoredEntry[] {
  const k1 = 1.5;
  const b = 0.75;
  const queryTerms = Array.from(new Set(tokenize(query)));
  if (queryTerms.length === 0 || corpus.length === 0) return [];

  const docTokens = corpus.map((doc) => tokenize(doc.text));
  const docLengths = docTokens.map((t) => t.length);
  const avgDocLength = docLengths.reduce((a, b2) => a + b2, 0) / (docLengths.length || 1);

  const df = new Map<string, number>();
  for (const term of queryTerms) {
    let count = 0;
    for (const tokens of docTokens) if (tokens.includes(term)) count += 1;
    df.set(term, count);
  }
  const N = corpus.length;

  const scored = corpus.map((doc, i) => {
    const tokens = docTokens[i];
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    let score = 0;
    for (const term of queryTerms) {
      const freq = tf.get(term) ?? 0;
      if (freq === 0) continue;
      const idf = Math.log(1 + (N - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
      const denom = freq + k1 * (1 - b + (b * docLengths[i]) / (avgDocLength || 1));
      score += idf * ((freq * (k1 + 1)) / (denom || 1));
    }
    return { id: doc.id, text: doc.text, score, metadata: doc.metadata };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, topK);
}

/**
 * Reciprocal Rank Fusion — combines a vector-search ranked list and a
 * BM25 keyword-search ranked list into one ranking without needing to
 * normalize scores across the two very different scales. Standard
 * industry approach for hybrid search (k=60 is the usual default).
 */
export function reciprocalRankFusion(rankedLists: ScoredEntry[][], k = 60): ScoredEntry[] {
  const fused = new Map<string, { entry: ScoredEntry; score: number }>();
  for (const list of rankedLists) {
    list.forEach((entry, rank) => {
      const contribution = 1 / (k + rank + 1);
      const existing = fused.get(entry.id);
      if (existing) {
        existing.score += contribution;
      } else {
        fused.set(entry.id, { entry, score: contribution });
      }
    });
  }
  return Array.from(fused.values())
    .sort((a, b) => b.score - a.score)
    .map(({ entry, score }) => ({ ...entry, score }));
}
