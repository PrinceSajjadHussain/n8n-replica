import { registerNode } from './types';
import type { NodePlugin } from './types';
import { getByPath, setByPath } from '../engine/jsonPath';

/**
 * HTML Extract — n8n's CSS-selector scraping node. `cheerio` is already a
 * worker dependency (used by the RAG web loader, see rag/loaders.ts) so this
 * reuses it via the same lazy `require()` pattern rather than a static
 * import, keeping startup cost down for workflows that never use it.
 *
 * ITEM-AWARE: runs once per item.
 *
 * params:
 *   sourceField?: string   dot-path to the item's HTML string (defaults to the
 *                           whole item's json.html, then falls back to the raw
 *                           item json if it's already a string)
 *   extractions: Array<{
 *     key: string            output field name
 *     selector: string       CSS selector
 *     attribute?: string     read this attribute instead of text content (e.g. "href")
 *     multiple?: boolean     collect every match into an array instead of just the first
 *   }>
 */
interface Extraction {
  key: string;
  selector: string;
  attribute?: string;
  multiple?: boolean;
}

export const htmlExtractNode: NodePlugin = {
  type: 'htmlExtract',
  async execute({ items, params }) {
    const cheerio = require('cheerio');
    const sourceField = params.sourceField ? String(params.sourceField) : '';
    const extractions = (params.extractions as Extraction[]) ?? [];
    if (extractions.length === 0) {
      throw new Error('HTML Extract node: params.extractions must have at least one { key, selector } entry');
    }

    const sourceItems = items.length > 0 ? items : [{ json: {} }];

    const outItems = sourceItems.map((item, i) => {
      const raw = sourceField
        ? getByPath(item.json, sourceField)
        : typeof item.json === 'string'
          ? item.json
          : (item.json as Record<string, unknown>)?.html;
      const html = typeof raw === 'string' ? raw : '';
      const $ = cheerio.load(html);

      const outJson: Record<string, unknown> = { ...item.json };
      for (const ext of extractions) {
        const nodes = $(ext.selector);
        const read = (el: unknown): string => (ext.attribute ? String($(el).attr(ext.attribute) ?? '') : $(el).text().trim());
        if (ext.multiple) {
          setByPath(outJson, ext.key, nodes.toArray().map(read));
        } else {
          setByPath(outJson, ext.key, nodes.length > 0 ? read(nodes.get(0)) : null);
        }
      }

      return { json: outJson, binary: item.binary, pairedItem: item.pairedItem ?? { item: i } };
    });

    return { items: outItems };
  },
};

registerNode(htmlExtractNode);
