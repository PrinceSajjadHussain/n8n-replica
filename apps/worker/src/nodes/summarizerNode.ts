import { registerNode } from './types';
import type { NodePlugin } from './types';
import { resolveMicroNodeApiKey, callLlm, type MicroNodeProvider } from './llmMicroNodeShared';

/**
 * Summarization Chain — dedicated micro-node (n8n's LangChain "Summarization
 * Chain" node). Plain-text output (not JSON mode) since a summary is
 * naturally prose, not structured data.
 *
 * params:
 *   provider?: 'openai' | 'anthropic' | 'gemini'   default 'openai'
 *   model?: string
 *   text?: string       text to summarize. Supports {{input}}.
 *   style?: 'concise' | 'detailed' | 'bullets'   default 'concise'
 *   maxSentences?: number   soft guidance, default 3 (ignored for 'bullets', which uses maxBullets instead)
 *   maxBullets?: number     default 5, only used when style is 'bullets'
 */
export const summarizerNode: NodePlugin = {
  type: 'summarizer',
  async execute({ input, params, credential }) {
    const provider = (String(params.provider ?? 'openai') as MicroNodeProvider);
    const apiKey = resolveMicroNodeApiKey(provider, credential, 'summarizer node');
    const model = params.model ? String(params.model) : undefined;

    const textTemplate = String(params.text ?? '{{input}}');
    const text = textTemplate.replace('{{input}}', typeof input === 'string' ? input : JSON.stringify(input ?? {}));

    const style = String(params.style ?? 'concise');
    const maxSentences = Number(params.maxSentences ?? 3);
    const maxBullets = Number(params.maxBullets ?? 5);

    let styleInstruction: string;
    if (style === 'bullets') {
      styleInstruction = `Summarize as at most ${maxBullets} short bullet points, one key fact per bullet, no preamble.`;
    } else if (style === 'detailed') {
      styleInstruction = 'Write a thorough paragraph-form summary covering all major points, not just the headline.';
    } else {
      styleInstruction = `Summarize in at most ${maxSentences} sentences. Be concise; no preamble like "Here is a summary".`;
    }

    const systemPrompt = `You are a summarization engine. ${styleInstruction}`;

    const summary = await callLlm({ provider, apiKey, model, systemPrompt, userPrompt: text, temperature: 0.2 });

    return {
      output: {
        summary: summary.trim(),
        style,
      },
    };
  },
};

registerNode(summarizerNode);
