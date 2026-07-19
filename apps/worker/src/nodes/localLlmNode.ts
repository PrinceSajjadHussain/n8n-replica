import axios from 'axios';
import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * Local LLM node — talks to a self-hosted model server instead of a paid
 * cloud API. Two wire protocols are supported since they cover the two
 * dominant self-hosting stacks:
 *
 *   - 'ollama'          native Ollama `/api/chat` endpoint (the default when
 *                        you `ollama run llama3.1` locally — no auth needed).
 *   - 'openaiCompatible' the OpenAI-shaped `/v1/chat/completions` endpoint
 *                        that vLLM, LM Studio, llama.cpp's server, text-
 *                        generation-webui, and Ollama itself (as of its /v1
 *                        compat layer) all expose.
 *
 * credential (type 'localLlm', OPTIONAL): { apiKey?: string }
 *   Most local servers have no auth at all — leave the node's credential
 *   unset. Only attach one if your server sits behind a bearer token (e.g. a
 *   vLLM instance with --api-key set).
 *
 * params:
 *   provider?: 'ollama' | 'openaiCompatible'   default 'ollama'
 *   baseUrl?: string     default 'http://localhost:11434' (Ollama's default port)
 *   model?: string       default 'llama3.1'
 *   systemPrompt?: string
 *   prompt?: string      supports {{input}} to splice in upstream JSON output
 *   temperature?: number default 0.3
 *   jsonMode?: boolean   default false — asks the model to return raw JSON
 */
export const localLlmNode: NodePlugin = {
  type: 'localLlm',
  async execute({ input, params, credential }) {
    const provider = params.provider === 'openaiCompatible' ? 'openaiCompatible' : 'ollama';
    const baseUrl = String(params.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '');
    const model = String(params.model ?? 'llama3.1');
    const temperature = Number(params.temperature ?? 0.3);
    const jsonMode = Boolean(params.jsonMode);
    const promptTemplate = String(params.prompt ?? '{{input}}');
    const prompt = promptTemplate.replace('{{input}}', JSON.stringify(input ?? {}));
    const apiKey = (credential?.apiKey as string) ?? undefined;

    const messages: Array<{ role: string; content: string }> = [];
    if (params.systemPrompt) messages.push({ role: 'system', content: String(params.systemPrompt) });
    messages.push({ role: 'user', content: prompt });

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const wrapConnectionError = (err: unknown): Error => {
      const code = (err as { code?: string })?.code;
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
        return new Error(
          `localLlm node: couldn't reach ${baseUrl} (${code}). Make sure your local model server ` +
            `(Ollama: \`ollama serve\`, or vLLM/LM Studio/llama.cpp) is running and reachable from the worker process.`
        );
      }
      return err instanceof Error ? err : new Error(String(err));
    };

    let text = '';
    let raw: unknown;

    if (provider === 'ollama') {
      try {
        const response = await axios.post(
          `${baseUrl}/api/chat`,
          {
            model,
            messages,
            stream: false,
            ...(jsonMode ? { format: 'json' } : {}),
            options: { temperature },
          },
          { headers, timeout: 120000 }
        );
        raw = response.data;
        text = response.data?.message?.content ?? '';
      } catch (err) {
        throw wrapConnectionError(err);
      }
    } else {
      try {
        const response = await axios.post(
          `${baseUrl}/v1/chat/completions`,
          {
            model,
            messages,
            temperature,
            ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
          },
          { headers, timeout: 120000 }
        );
        raw = response.data;
        text = response.data?.choices?.[0]?.message?.content ?? '';
      } catch (err) {
        throw wrapConnectionError(err);
      }
    }

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
        provider,
        raw,
      },
    };
  },
};

registerNode(localLlmNode);
