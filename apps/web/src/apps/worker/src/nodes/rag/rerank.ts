import axios from 'axios';
import type { ScoredEntry } from './types';

export type RerankProvider = 'none' | 'cohere' | 'llm';

/**
 * Cohere Rerank — a real cross-encoder reranker (not just re-scoring with
 * a chat model). Needs a "cohere" credential { apiKey } or COHERE_API_KEY.
 */
async function cohereRerank(query: string, candidates: ScoredEntry[], apiKey: string, topN: number): Promise<ScoredEntry[]> {
  const res = await axios.post(
    'https://api.cohere.com/v1/rerank',
    { model: 'rerank-english-v3.0', query, documents: candidates.map((c) => c.text), top_n: Math.min(topN, candidates.length) },
    { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 30000 }
  );
  return (res.data.results as { index: number; relevance_score: number }[]).map((r) => ({
    ...candidates[r.index],
    score: r.relevance_score,
  }));
}

/**
 * LLM-based reranker fallback for when no dedicated reranker API key is
 * configured: asks the chat model to score each candidate's relevance
 * 0-10 against the query, in one batched call. Meaningfully improves
 * precision over raw vector/BM25 scores at the cost of one extra LLM call.
 */
async function llmRerank(query: string, candidates: ScoredEntry[], apiKey: string, model: string, topN: number): Promise<ScoredEntry[]> {
  const listing = candidates.map((c, i) => `[${i}] ${c.text.slice(0, 800)}`).join('\n\n');
  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a relevance-ranking judge. Score how relevant each numbered passage is to the question, 0 (irrelevant) to 10 (directly answers it). Respond ONLY with JSON: {"scores": [{"index": number, "score": number}, ...]} covering every passage index given.',
        },
        { role: 'user', content: `Question: ${query}\n\nPassages:\n${listing}` },
      ],
    },
    { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 60000 }
  );
  let parsed: { scores: { index: number; score: number }[] };
  try {
    parsed = JSON.parse(res.data.choices?.[0]?.message?.content ?? '{"scores":[]}');
  } catch {
    parsed = { scores: [] };
  }
  const scoreByIndex = new Map(parsed.scores.map((s) => [s.index, s.score]));
  return candidates
    .map((c, i) => ({ ...c, score: scoreByIndex.get(i) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

export async function rerank(
  provider: RerankProvider,
  query: string,
  candidates: ScoredEntry[],
  topN: number,
  opts: { cohereApiKey?: string; openaiApiKey?: string; model?: string }
): Promise<ScoredEntry[]> {
  if (provider === 'none' || candidates.length === 0) return candidates.slice(0, topN);
  if (provider === 'cohere') {
    if (!opts.cohereApiKey) throw new Error('rerank: provider "cohere" requires a "cohere" credential with { apiKey }.');
    return cohereRerank(query, candidates, opts.cohereApiKey, topN);
  }
  if (!opts.openaiApiKey) throw new Error('rerank: provider "llm" requires an "openai" credential.');
  return llmRerank(query, candidates, opts.openaiApiKey, opts.model ?? 'gpt-4o-mini', topN);
}
