import axios from 'axios';
import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * Mistral node — real call to Mistral's Chat Completions API (`la
 * plateforme`). Same request/response shape family as OpenAI's Chat
 * Completions (messages array in, choices[0].message.content out,
 * response_format: { type: 'json_object' } for JSON mode), so this mirrors
 * `openaiNode.ts` with a different base URL/model default.
 *
 * credential (type 'mistral'): { apiKey: string }
 * params:
 *   model?: string            default 'mistral-large-latest'
 *   systemPrompt?: string     optional system message
 *   prompt?: string           user message. Supports {{input}} to splice in
 *                             the JSON-stringified upstream node output.
 *   temperature?: number      default 0.3
 *   jsonMode?: boolean        if true, asks the model to return raw JSON and
 *                             the node output.parsed will contain the parsed value
 */
export const mistralNode: NodePlugin = {
  type: 'mistral',
  async execute({ input, params, credential }) {
    const apiKey = (credential?.apiKey as string) ?? process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      throw new Error(
        'mistral node: no API key. Add a "mistral" credential with { "apiKey": "..." } and select it on this node, or set MISTRAL_API_KEY on the worker.'
      );
    }

    const model = String(params.model ?? 'mistral-large-latest');
    const temperature = Number(params.temperature ?? 0.3);
    const jsonMode = Boolean(params.jsonMode);
    const promptTemplate = String(params.prompt ?? '{{input}}');
    const prompt = promptTemplate.replace('{{input}}', JSON.stringify(input ?? {}));

    const messages: Array<{ role: string; content: string }> = [];
    if (params.systemPrompt) messages.push({ role: 'system', content: String(params.systemPrompt) });
    messages.push({ role: 'user', content: prompt });

    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model,
        messages,
        temperature,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      },
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 60000,
      }
    );

    const text: string = response.data.choices?.[0]?.message?.content ?? '';
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
        usage: response.data.usage,
      },
    };
  },
};

registerNode(mistralNode);
