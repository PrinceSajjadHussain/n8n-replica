import { registerNode } from './types';
import type { NodePlugin } from './types';
import { getByPath, setByPath } from '../engine/jsonPath';

/**
 * Text parser — Make.com's "Text parser" module family (regex match/test,
 * split, replace) previously only reachable via the Code node.
 *
 * ITEM-AWARE: runs once per item.
 *
 * params:
 *   operation: 'match' | 'matchAll' | 'test' | 'split' | 'replace'   default 'match'
 *   sourceField?: string    dot-path to the input string; defaults to the whole item
 *                            json if it's already a string
 *   pattern: string          regex source (for match/matchAll/test/replace) or plain
 *                            separator string (for split)
 *   flags?: string           regex flags, default 'g' for matchAll, '' otherwise
 *   replacement?: string     used by 'replace' — supports $1, $2 capture-group refs
 *   destinationField?: string  default 'result'
 */
export const textParserNode: NodePlugin = {
  type: 'textParser',
  async execute({ items, params }) {
    const operation = String(params.operation ?? 'match');
    const sourceField = params.sourceField ? String(params.sourceField) : '';
    const pattern = String(params.pattern ?? '');
    const destinationField = String(params.destinationField ?? 'result');

    if (!pattern) throw new Error('Text parser node: params.pattern is required');

    const sourceItems = items.length > 0 ? items : [{ json: {} }];

    const outItems = sourceItems.map((item, i) => {
      const raw = sourceField ? getByPath(item.json, sourceField) : item.json;
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
      const outJson: Record<string, unknown> = { ...item.json };

      let result: unknown;
      if (operation === 'split') {
        result = text.split(pattern);
      } else if (operation === 'test') {
        const flags = String(params.flags ?? '');
        result = new RegExp(pattern, flags).test(text);
      } else if (operation === 'match') {
        const flags = String(params.flags ?? '');
        const m = text.match(new RegExp(pattern, flags));
        result = m ? { fullMatch: m[0], groups: m.slice(1) } : null;
      } else if (operation === 'matchAll') {
        const flags = String(params.flags ?? 'g').includes('g') ? String(params.flags ?? 'g') : `${params.flags ?? ''}g`;
        result = Array.from(text.matchAll(new RegExp(pattern, flags))).map((m) => ({ fullMatch: m[0], groups: m.slice(1) }));
      } else if (operation === 'replace') {
        const flags = String(params.flags ?? 'g').includes('g') ? String(params.flags ?? 'g') : `${params.flags ?? ''}g`;
        const replacement = String(params.replacement ?? '');
        result = text.replace(new RegExp(pattern, flags), replacement);
      } else {
        throw new Error(`Text parser node: unknown operation "${operation}"`);
      }

      setByPath(outJson, destinationField, result);
      return { json: outJson, binary: item.binary, pairedItem: item.pairedItem ?? { item: i } };
    });

    return { items: outItems };
  },
};

registerNode(textParserNode);
