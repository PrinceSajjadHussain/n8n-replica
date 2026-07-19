import { registerNode } from './types';
import type { NodePlugin } from './types';
import { resolveMicroNodeApiKey, callLlm, tryParseJson, type MicroNodeProvider } from './llmMicroNodeShared';

/**
 * Text Classifier — dedicated micro-node wrapping a single-turn LLM call
 * with a fixed category list, so a workflow author doesn't have to
 * hand-write a JSON-mode prompt on the generic AI node to do this common
 * task (n8n's LangChain "Text Classifier" node).
 *
 * credential: any of 'openai' (default) / 'anthropic' / 'gemini', selected
 * via params.provider.
 * params:
 *   provider?: 'openai' | 'anthropic' | 'gemini'   default 'openai'
 *   model?: string
 *   text?: string          text to classify. Supports {{input}}.
 *   categories: string     comma-separated list of allowed category labels
 *   multiLabel?: boolean   default false — allow more than one category
 */
export const textClassifierNode: NodePlugin = {
  type: 'textClassifier',
  async execute({ input, params, credential }) {
    const provider = (String(params.provider ?? 'openai') as MicroNodeProvider);
    const apiKey = resolveMicroNodeApiKey(provider, credential, 'textClassifier node');
    const model = params.model ? String(params.model) : undefined;

    const categories = String(params.categories ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    if (categories.length === 0) {
      throw new Error('textClassifier node: "categories" must be a non-empty comma-separated list.');
    }
    const multiLabel = Boolean(params.multiLabel);

    const textTemplate = String(params.text ?? '{{input}}');
    const text = textTemplate.replace('{{input}}', typeof input === 'string' ? input : JSON.stringify(input ?? {}));

    const systemPrompt = `You are a precise text classifier. Allowed categories: ${categories.join(', ')}. ${
      multiLabel
        ? 'Return every category that applies.'
        : 'Return exactly one best-fit category.'
    } Respond with JSON only: { "categories": string[], "confidence": number (0-1) }. Category values must be exactly from the allowed list, verbatim.`;

    const raw = await callLlm({ provider, apiKey, model, systemPrompt, userPrompt: text, temperature: 0, jsonMode: true });
    const parsed = tryParseJson(raw) as { categories?: string[]; confidence?: number } | null;

    const resultCategories = (parsed?.categories ?? []).filter((c) => categories.includes(c));
    const category = resultCategories[0] ?? null;

    return {
      output: {
        category,
        categories: multiLabel ? resultCategories : category ? [category] : [],
        confidence: typeof parsed?.confidence === 'number' ? parsed.confidence : null,
        raw,
      },
    };
  },
};

registerNode(textClassifierNode);
