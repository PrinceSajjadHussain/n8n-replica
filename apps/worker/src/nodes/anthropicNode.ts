import axios from 'axios';
import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * Anthropic (Claude) node — real call to the Messages API.
 *
 * Closes a real integration gap: the AI node catalog was previously
 * OpenAI-only, forcing every workflow onto one vendor. This mirrors
 * `openaiNode.ts`'s param/credential shape so both nodes are interchangeable
 * in the palette and in the `agent` node's `AgentToolSpec` wiring.
 *
 * credential (type 'anthropic'): { apiKey: string }
 * params:
 *   model?: string            default 'claude-sonnet-4-5-20250929'
 *   systemPrompt?: string     optional system message
 *   prompt?: string           user message. Supports {{input}} to splice in
 *                             the JSON-stringified upstream node output.
 *   temperature?: number      default 0.3
 *   maxTokens?: number        default 1024 (required by the Messages API)
 */
export const anthropicNode: NodePlugin = {
  type: 'anthropic',
  async execute({ input, params, credential }) {
    const apiKey = (credential?.apiKey as string) ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'anthropic node: no API key. Add an "anthropic" credential with { "apiKey": "sk-ant-..." } and select it on this node, or set ANTHROPIC_API_KEY on the worker.'
      );
    }

    const model = String(params.model ?? 'claude-sonnet-4-5-20250929');
    const temperature = Number(params.temperature ?? 0.3);
    const maxTokens = Number(params.maxTokens ?? 1024);
    const promptTemplate = String(params.prompt ?? '{{input}}');
    const prompt = promptTemplate.replace('{{input}}', JSON.stringify(input ?? {}));

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model,
        max_tokens: maxTokens,
        temperature,
        ...(params.systemPrompt ? { system: String(params.systemPrompt) } : {}),
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      }
    );

    const text: string = (response.data.content ?? [])
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { text: string }) => block.text)
      .join('');

    return {
      output: {
        text,
        model,
        usage: response.data.usage,
        stopReason: response.data.stop_reason,
      },
    };
  },
};

registerNode(anthropicNode);
