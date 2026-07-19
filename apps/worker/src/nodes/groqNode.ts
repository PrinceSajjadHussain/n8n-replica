import axios from 'axios';
import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * Groq node — real call to Groq's OpenAI-compatible Chat Completions API
 * (LPU-hosted open models: Llama, Mixtral, Gemma, etc. — Groq's pitch is
 * speed, not a different wire protocol, so this mirrors `openaiNode.ts`
 * almost exactly with a different base URL/model default).
 *
 * credential (type 'groq'): { apiKey: string }
 * params:
 *   model?: string            default 'llama-3.3-70b-versatile'
 *   systemPrompt?: string     optional system message
 *   prompt?: string           user message. Supports {{input}} to splice in
 *                             the JSON-stringified upstream node output.
 *   temperature?: number      default 0.3
 *   jsonMode?: boolean        if true, asks the model to return raw JSON and
 *                             the node output.parsed will contain the parsed value
 */
export const groqNode: NodePlugin = {
  type: 'groq',
  async execute({ input, params, credential }) {
    const apiKey = (credential?.apiKey as string) ?? process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error(
        'groq node: no API key. Add a "groq" credential with { "apiKey": "gsk_..." } and select it on this node, or set GROQ_API_KEY on the worker.'
      );
    }

    const model = String(params.model ?? 'llama-3.3-70b-versatile');
    const temperature = Number(params.temperature ?? 0.3);
    const jsonMode = Boolean(params.jsonMode);
    const promptTemplate = String(params.prompt ?? '{{input}}');
    const prompt = promptTemplate.replace('{{input}}', JSON.stringify(input ?? {}));

    const messages: Array<{ role: string; content: string }> = [];
    if (params.systemPrompt) messages.push({ role: 'system', content: String(params.systemPrompt) });
    messages.push({ role: 'user', content: prompt });

    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
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

registerNode(groqNode);
