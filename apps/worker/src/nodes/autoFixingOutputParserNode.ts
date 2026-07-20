import { registerNode } from './types';
import type { NodePlugin } from './types';
import { resolveMicroNodeApiKey, callLlm, tryParseJson, type MicroNodeProvider } from './llmMicroNodeShared';
import { validateAgainstFields } from './structuredOutputParserNode';

/**
 * Auto-fixing Output Parser — same validation as Structured Output Parser,
 * but on failure it feeds the broken text plus the specific validation
 * error back to an LLM and asks it to correct the JSON, retrying up to
 * `maxRetries` times before giving up. Same role as n8n's Auto-fixing
 * Output Parser wrapping a chain/agent's structured output. Kept as a
 * separate node rather than a flag on Structured Output Parser because it
 * needs its own provider/credential config, which a pure validation node
 * shouldn't require.
 *
 * params:
 *   textField?: string       same meaning as Structured Output Parser's
 *   expectedFields: string   same "name: type" free-text schema
 *   provider?: 'openai' | 'anthropic' | 'gemini'   default 'openai'
 *   model?: string
 *   maxRetries?: number      default 2
 *   onFailure: 'error' | 'null'   what happens if still invalid after retries
 */
function parseExpectedFields(desc: string): { name: string; type: string }[] {
  return desc
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, type] = part.split(':').map((s) => s.trim());
      return { name: name || part, type: (type || 'any').toLowerCase() };
    });
}

export const autoFixingOutputParserNode: NodePlugin = {
  type: 'autoFixingOutputParser',
  async execute({ items, params, credential }) {
    const textField = params.textField ? String(params.textField) : '';
    const fields = parseExpectedFields(String(params.expectedFields ?? ''));
    const maxRetries = Math.max(0, Number(params.maxRetries ?? 2));
    const onFailure = String(params.onFailure ?? 'error');
    const provider = String(params.provider ?? 'openai') as MicroNodeProvider;
    const model = params.model ? String(params.model) : undefined;

    // Resolve the API key once up front (not per item) so a missing
    // credential fails fast instead of partway through a batch.
    const apiKey = resolveMicroNodeApiKey(provider, credential, 'autoFixingOutputParser node');

    const outItems = await Promise.all(
      items.map(async (item, i) => {
        const json = item.json as Record<string, unknown>;
        let rawText = typeof (textField ? json[textField] : json) === 'string'
          ? (textField ? (json[textField] as string) : (json as unknown as string))
          : JSON.stringify((textField ? json[textField] : json) ?? '');

        let parsed = tryParseJson(rawText);
        let problems = parsed === null ? ['Response was not valid JSON.'] : validateAgainstFields(parsed, fields);
        let attempts = 0;

        while (problems.length > 0 && attempts < maxRetries) {
          attempts++;
          const fixPrompt =
            `The following text was supposed to be a JSON object matching this schema: ${String(params.expectedFields ?? '')}\n\n` +
            `Text:\n${rawText}\n\nProblems found: ${problems.join(' ')}\n\n` +
            'Return ONLY the corrected JSON object, nothing else.';
          rawText = await callLlm({
            provider,
            apiKey,
            model,
            systemPrompt: 'You fix malformed JSON so it matches a described schema. Respond with JSON only.',
            userPrompt: fixPrompt,
            temperature: 0,
            jsonMode: true,
          });
          parsed = tryParseJson(rawText);
          problems = parsed === null ? ['Response was not valid JSON.'] : validateAgainstFields(parsed, fields);
        }

        if (problems.length > 0) {
          if (onFailure === 'error') {
            throw new Error(`Auto-fixing Output Parser: still invalid after ${attempts} retr${attempts === 1 ? 'y' : 'ies'}: ${problems.join(' ')}`);
          }
          return { json: { ...json, parsed: null, valid: false, problems, attempts }, binary: item.binary, pairedItem: { item: i } };
        }

        return { json: { ...json, parsed, valid: true, attempts }, binary: item.binary, pairedItem: { item: i } };
      })
    );

    return { items: outItems };
  },
};

registerNode(autoFixingOutputParserNode);
