import { registerNode } from './types';
import type { NodePlugin } from './types';
import { tryParseJson } from './llmMicroNodeShared';

/**
 * Structured Output Parser — validates that upstream text (typically an LLM
 * response) parses as JSON and roughly matches an expected field list,
 * without making another LLM call itself. Distinct from Entity Extractor:
 * Extractor turns *arbitrary* prose into structured fields via its own LLM
 * call; this node only checks/coerces text that's already supposed to be
 * JSON (e.g. sitting right after an Agent or a chain node in the graph),
 * same role as n8n's Structured Output Parser attached to a chain/agent.
 *
 * params:
 *   textField?: string     dot-path into input.json for the text to parse.
 *                          Blank = use `input` directly (string or object).
 *   expectedFields: string  comma/line-separated "name: type" pairs, same
 *                           free-text shape as Entity Extractor's
 *                           schemaDescription, used only for the presence/
 *                           type check below (not sent to any LLM).
 *   onFailure: 'error' | 'null' | 'passthroughRaw'   default 'error'
 */
type ExpectedField = { name: string; type: string };

function parseExpectedFields(desc: string): ExpectedField[] {
  return desc
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, type] = part.split(':').map((s) => s.trim());
      return { name: name || part, type: (type || 'any').toLowerCase() };
    });
}

function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      return true; // 'any' or unrecognized type name — presence-only check
  }
}

/** Checks parsed JSON against the expected field list. Returns a list of human-readable problems (empty = valid). */
export function validateAgainstFields(parsed: unknown, fields: ExpectedField[]): string[] {
  if (fields.length === 0) return [];
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return ['Expected a JSON object at the top level.'];
  }
  const obj = parsed as Record<string, unknown>;
  const problems: string[] = [];
  for (const { name, type } of fields) {
    if (!(name in obj)) {
      problems.push(`Missing field "${name}".`);
      continue;
    }
    if (obj[name] !== null && !typeMatches(obj[name], type)) {
      problems.push(`Field "${name}" should be ${type}, got ${typeof obj[name]}.`);
    }
  }
  return problems;
}

export const structuredOutputParserNode: NodePlugin = {
  type: 'structuredOutputParser',
  async execute({ items, params }) {
    const textField = params.textField ? String(params.textField) : '';
    const fields = parseExpectedFields(String(params.expectedFields ?? ''));
    const onFailure = String(params.onFailure ?? 'error');

    const outItems = items.map((item, i) => {
      const json = item.json as Record<string, unknown>;
      const raw = textField
        ? (json[textField] as unknown)
        : json;
      const rawText = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');

      const parsed = tryParseJson(rawText);
      const problems = parsed === null ? ['Response was not valid JSON.'] : validateAgainstFields(parsed, fields);

      if (problems.length > 0) {
        if (onFailure === 'error') {
          throw new Error(`Structured Output Parser: ${problems.join(' ')}`);
        }
        if (onFailure === 'passthroughRaw') {
          return { json: { ...json, parsed: null, valid: false, problems, raw: rawText }, binary: item.binary, pairedItem: { item: i } };
        }
        // 'null'
        return { json: { ...json, parsed: null, valid: false, problems }, binary: item.binary, pairedItem: { item: i } };
      }

      return { json: { ...json, parsed, valid: true, problems: [] }, binary: item.binary, pairedItem: { item: i } };
    });

    return { items: outItems };
  },
};

registerNode(structuredOutputParserNode);
