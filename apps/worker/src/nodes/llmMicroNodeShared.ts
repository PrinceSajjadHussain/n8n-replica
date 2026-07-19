import axios from 'axios';

/**
 * Shared "call one of the three cloud chat providers with a system+user
 * prompt, get text back" helper for the dedicated AI micro-nodes
 * (textClassifier, sentimentAnalysis, entityExtractor, summarizer, qaChain).
 *
 * This is the same three-provider dispatch `ragNode.ts`'s internal
 * `answerWithProvider` does (OpenAI Chat Completions / Anthropic Messages /
 * Gemini generateContent) but factored out and exported so the micro-nodes
 * don't duplicate it a fifth and sixth time. `ragNode.ts` keeps its own
 * private copy rather than importing this — left untouched on purpose,
 * per the "don't refactor unrelated code while you're in there" rule.
 */

export type MicroNodeProvider = 'openai' | 'anthropic' | 'gemini';

export function resolveMicroNodeApiKey(
  provider: MicroNodeProvider,
  credential: Record<string, unknown> | null,
  nodeLabel: string
): string {
  if (provider === 'gemini') {
    const key = (credential?.apiKey as string) ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!key) throw new Error(`${nodeLabel}: provider "gemini" requires a "gemini" credential with apiKey, or GEMINI_API_KEY on the worker.`);
    return key;
  }
  if (provider === 'anthropic') {
    const key = (credential?.apiKey as string) ?? process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error(`${nodeLabel}: provider "anthropic" requires an "anthropic" credential with apiKey, or ANTHROPIC_API_KEY on the worker.`);
    return key;
  }
  const key = (credential?.apiKey as string) ?? process.env.OPENAI_API_KEY;
  if (!key) throw new Error(`${nodeLabel}: provider "openai" requires an "openai" credential with apiKey, or OPENAI_API_KEY on the worker, or set provider to "anthropic"/"gemini".`);
  return key;
}

export interface CallLlmOptions {
  provider: MicroNodeProvider;
  apiKey: string;
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  /** Ask the model to return raw JSON. Best-effort across providers — see callLlm's per-provider handling. */
  jsonMode?: boolean;
}

/** Single-turn call to whichever provider is configured. Returns the raw text response. */
export async function callLlm(opts: CallLlmOptions): Promise<string> {
  const { provider, apiKey, model, systemPrompt, userPrompt } = opts;
  const temperature = opts.temperature ?? 0.2;

  if (provider === 'gemini') {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model ?? 'gemini-2.0-flash'}:generateContent?key=${apiKey}`,
      {
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature,
          ...(opts.jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
      },
      { timeout: 60000 }
    );
    const parts = response.data.candidates?.[0]?.content?.parts ?? [];
    return parts.map((p: { text?: string }) => p.text ?? '').join('');
  }

  if (provider === 'anthropic') {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: model ?? 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        temperature,
        system: opts.jsonMode ? `${systemPrompt}\n\nRespond with raw JSON only, no prose, no markdown code fences.` : systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      },
      { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, timeout: 60000 }
    );
    return (response.data.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('');
  }

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: model ?? 'gpt-4o-mini',
      temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    },
    { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 }
  );
  return response.data.choices?.[0]?.message?.content ?? '';
}

/** Parses text as JSON, stripping ```json fences some providers add despite instructions. Returns null on failure. */
export function tryParseJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
