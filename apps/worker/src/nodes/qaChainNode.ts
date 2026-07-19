import { registerNode } from './types';
import type { NodePlugin } from './types';
import { resolveMicroNodeApiKey, callLlm, type MicroNodeProvider } from './llmMicroNodeShared';

/**
 * Q&A Chain — dedicated micro-node (n8n's LangChain "Question and Answer
 * Chain" node). Answers a question against a block of context text you
 * already have in hand (e.g. from an HTTP Request or file read) — a direct
 * context-in/answer-out call, no retrieval step.
 *
 * This is deliberately NOT the same as `ragQuery`: ragQuery does chunking +
 * embedding + vector/keyword hybrid search over a whole knowledge base and
 * then answers from the retrieved chunks. qaChain skips retrieval entirely
 * and answers directly against whatever context text you pass it — the
 * right tool when you already know which document/section is relevant and
 * don't need a search step, and a much cheaper/simpler node to configure
 * for that case.
 *
 * params:
 *   provider?: 'openai' | 'anthropic' | 'gemini'   default 'openai'
 *   model?: string
 *   context?: string    the source text to answer from. Supports {{input}}.
 *   question: string    the question to answer. Supports {{input}}.
 *   requireContextOnly?: boolean   default true — instructs the model not to
 *                                  use outside knowledge; if the answer isn't
 *                                  in the context, say so rather than guessing.
 */
export const qaChainNode: NodePlugin = {
  type: 'qaChain',
  async execute({ input, params, credential }) {
    const provider = (String(params.provider ?? 'openai') as MicroNodeProvider);
    const apiKey = resolveMicroNodeApiKey(provider, credential, 'qaChain node');
    const model = params.model ? String(params.model) : undefined;

    const inputStr = typeof input === 'string' ? input : JSON.stringify(input ?? {});
    const contextTemplate = String(params.context ?? '{{input}}');
    const context = contextTemplate.replace('{{input}}', inputStr);

    const question = String(params.question ?? '').trim();
    if (!question) {
      throw new Error('qaChain node: "question" is required.');
    }

    const requireContextOnly = params.requireContextOnly !== false;

    const systemPrompt = requireContextOnly
      ? 'Answer the question using ONLY the provided context. If the answer is not present in the context, respond exactly with "Not found in the provided context." Do not use outside knowledge.'
      : 'Answer the question using the provided context as your primary source, supplementing with general knowledge only where the context is silent. Note clearly when you do so.';

    const userPrompt = `Context:\n${context}\n\nQuestion: ${question}`;

    const answer = await callLlm({ provider, apiKey, model, systemPrompt, userPrompt, temperature: 0.1 });

    const notFound = requireContextOnly && answer.trim().toLowerCase().startsWith('not found in the provided context');

    return {
      output: {
        answer: answer.trim(),
        question,
        found: !notFound,
      },
    };
  },
};

registerNode(qaChainNode);
