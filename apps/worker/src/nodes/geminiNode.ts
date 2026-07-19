import axios from 'axios';
import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * Google Gemini node — real call to the Generative Language API
 * (`generateContent`), plus an `embedGemini` helper reused by `ragNode.ts`
 * so ingest/query can run entirely on Gemini (chat model + embedding model)
 * as an alternative to the OpenAI-only pipeline.
 *
 * credential (type 'gemini'): { apiKey: string }
 * params:
 *   model?: string            default 'gemini-2.0-flash'
 *   systemPrompt?: string     optional system instruction
 *   prompt?: string           user message. Supports {{input}} to splice in
 *                             the JSON-stringified upstream node output.
 *   temperature?: number      default 0.3
 *   maxOutputTokens?: number  default 2048
 *   jsonMode?: boolean        if true, asks for application/json response
 *                             and the node output.parsed will contain it
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function resolveApiKey(credential: Record<string, unknown> | null): string {
  const apiKey = (credential?.apiKey as string) ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'gemini node: no API key. Add a "gemini" credential with { "apiKey": "..." } and select it on this node, or set GEMINI_API_KEY on the worker.'
    );
  }
  return apiKey;
}

/** Batched embeddings via Gemini's `embedContent`/`batchEmbedContents` (text-embedding-004). Shared with ragNode.ts. */
export async function embedGemini(apiKey: string, texts: string[], model = 'text-embedding-004'): Promise<number[][]> {
  const response = await axios.post(
    `${GEMINI_BASE}/models/${model}:batchEmbedContents?key=${apiKey}`,
    {
      requests: texts.map((text) => ({
        model: `models/${model}`,
        content: { parts: [{ text }] },
      })),
    },
    { timeout: 60000 }
  );
  return response.data.embeddings.map((e: { values: number[] }) => e.values);
}

export const geminiNode: NodePlugin = {
  type: 'gemini',
  async execute({ input, params, credential }) {
    const apiKey = resolveApiKey(credential);
    const model = String(params.model ?? 'gemini-2.0-flash');
    const temperature = Number(params.temperature ?? 0.3);
    const maxOutputTokens = Number(params.maxOutputTokens ?? 2048);
    const jsonMode = Boolean(params.jsonMode);
    const promptTemplate = String(params.prompt ?? '{{input}}');
    const prompt = promptTemplate.replace('{{input}}', JSON.stringify(input ?? {}));

    const response = await axios.post(
      `${GEMINI_BASE}/models/${model}:generateContent?key=${apiKey}`,
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        ...(params.systemPrompt
          ? { systemInstruction: { parts: [{ text: String(params.systemPrompt) }] } }
          : {}),
        generationConfig: {
          temperature,
          maxOutputTokens,
          ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 60000 }
    );

    const candidate = response.data.candidates?.[0];
    const text: string = (candidate?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');

    let parsed: unknown = null;
    if (jsonMode) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    return {
      output: {
        text,
        parsed,
        model,
        usage: response.data.usageMetadata,
        finishReason: candidate?.finishReason,
      },
    };
  },
};

registerNode(geminiNode);
