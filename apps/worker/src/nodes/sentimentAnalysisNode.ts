import { registerNode } from './types';
import type { NodePlugin } from './types';
import { resolveMicroNodeApiKey, callLlm, tryParseJson, type MicroNodeProvider } from './llmMicroNodeShared';

/**
 * Sentiment Analysis — dedicated micro-node (n8n's LangChain "Sentiment
 * Analysis" node). Returns a fixed label + score rather than freeform text
 * so downstream IF/Switch nodes can branch on it directly.
 *
 * params:
 *   provider?: 'openai' | 'anthropic' | 'gemini'   default 'openai'
 *   model?: string
 *   text?: string    text to analyze. Supports {{input}}.
 */
export const sentimentAnalysisNode: NodePlugin = {
  type: 'sentimentAnalysis',
  async execute({ input, params, credential }) {
    const provider = (String(params.provider ?? 'openai') as MicroNodeProvider);
    const apiKey = resolveMicroNodeApiKey(provider, credential, 'sentimentAnalysis node');
    const model = params.model ? String(params.model) : undefined;

    const textTemplate = String(params.text ?? '{{input}}');
    const text = textTemplate.replace('{{input}}', typeof input === 'string' ? input : JSON.stringify(input ?? {}));

    const systemPrompt =
      'You are a sentiment analysis engine. Classify the sentiment of the given text. ' +
      'Respond with JSON only: { "sentiment": "positive" | "neutral" | "negative", "score": number (-1 to 1, negative = negative sentiment), "reasoning": string (one short sentence) }.';

    const raw = await callLlm({ provider, apiKey, model, systemPrompt, userPrompt: text, temperature: 0, jsonMode: true });
    const parsed = tryParseJson(raw) as { sentiment?: string; score?: number; reasoning?: string } | null;

    const sentiment = ['positive', 'neutral', 'negative'].includes(String(parsed?.sentiment))
      ? (parsed!.sentiment as string)
      : 'neutral';

    return {
      output: {
        sentiment,
        score: typeof parsed?.score === 'number' ? parsed.score : null,
        reasoning: parsed?.reasoning ?? null,
        raw,
      },
    };
  },
};

registerNode(sentimentAnalysisNode);
