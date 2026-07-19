import { registerNode } from './types';
import type { NodePlugin } from './types';
import { resolveMicroNodeApiKey, callLlm, tryParseJson, type MicroNodeProvider } from './llmMicroNodeShared';

/**
 * Information/Entity Extractor — dedicated micro-node (n8n's LangChain
 * "Information Extractor" node). Given a plain-English description of a
 * schema (field name: type/description pairs), returns structured JSON
 * matching it — the most common "turn unstructured text into fields I can
 * use downstream" task, without hand-writing a JSON-mode prompt each time.
 *
 * params:
 *   provider?: 'openai' | 'anthropic' | 'gemini'   default 'openai'
 *   model?: string
 *   text?: string       source text. Supports {{input}}.
 *   schemaDescription: string
 *     Plain-English field list, e.g.:
 *       "name: string, email: string, orderTotal: number, isUrgent: boolean"
 *     One field per line or comma-separated; free-text, not a strict JSON
 *     Schema, since the point of this node is skipping schema authoring.
 */
export const entityExtractorNode: NodePlugin = {
  type: 'entityExtractor',
  async execute({ input, params, credential }) {
    const provider = (String(params.provider ?? 'openai') as MicroNodeProvider);
    const apiKey = resolveMicroNodeApiKey(provider, credential, 'entityExtractor node');
    const model = params.model ? String(params.model) : undefined;

    const schemaDescription = String(params.schemaDescription ?? '').trim();
    if (!schemaDescription) {
      throw new Error('entityExtractor node: "schemaDescription" is required (e.g. "name: string, email: string, orderTotal: number").');
    }

    const textTemplate = String(params.text ?? '{{input}}');
    const text = textTemplate.replace('{{input}}', typeof input === 'string' ? input : JSON.stringify(input ?? {}));

    const systemPrompt =
      'You extract structured information from text. Extract fields matching this description: ' +
      `${schemaDescription}. Respond with a single JSON object with exactly those field names as keys. ` +
      'If a field cannot be found in the text, set its value to null. Do not invent values that aren\'t supported by the text.';

    const raw = await callLlm({ provider, apiKey, model, systemPrompt, userPrompt: text, temperature: 0, jsonMode: true });
    const parsed = tryParseJson(raw);

    return {
      output: {
        extracted: parsed ?? null,
        raw,
      },
    };
  },
};

registerNode(entityExtractorNode);
