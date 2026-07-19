import { registerNode } from './types';
import type { NodePlugin } from './types';
import { getByPath, setByPath } from '../engine/jsonPath';

/**
 * Markdown <-> HTML — bidirectional conversion node. Uses `marked` for
 * Markdown -> HTML and `turndown` for HTML -> Markdown (both new worker
 * dependencies, added this round — small, dependency-light, no native
 * bindings, matching the "no paid API key" mock-mode-exempt profile the
 * rest of the data-transformation nodes have).
 *
 * ITEM-AWARE: runs once per item.
 *
 * params:
 *   direction: 'toHtml' | 'toMarkdown'   default 'toHtml'
 *   sourceField?: string                  dot-path to the input string (defaults
 *                                          to the whole item json if it's already
 *                                          a string, else json.markdown/json.html)
 *   destinationField?: string             default 'html' or 'markdown' to match direction
 */
export const markdownHtmlNode: NodePlugin = {
  type: 'markdownHtml',
  async execute({ items, params }) {
    const direction = params.direction === 'toMarkdown' ? 'toMarkdown' : 'toHtml';
    const sourceField = params.sourceField ? String(params.sourceField) : '';
    const destinationField = params.destinationField
      ? String(params.destinationField)
      : direction === 'toHtml'
        ? 'html'
        : 'markdown';

    const sourceItems = items.length > 0 ? items : [{ json: {} }];

    if (direction === 'toHtml') {
      const { marked } = require('marked');
      const outItems = sourceItems.map((item, i) => {
        const raw = sourceField
          ? getByPath(item.json, sourceField)
          : typeof item.json === 'string'
            ? item.json
            : (item.json as Record<string, unknown>)?.markdown;
        const html = marked.parse(typeof raw === 'string' ? raw : '', { async: false }) as string;
        const outJson: Record<string, unknown> = { ...item.json };
        setByPath(outJson, destinationField, html);
        return { json: outJson, binary: item.binary, pairedItem: item.pairedItem ?? { item: i } };
      });
      return { items: outItems };
    }

    const TurndownService = require('turndown');
    const turndown = new TurndownService();
    const outItems = sourceItems.map((item, i) => {
      const raw = sourceField
        ? getByPath(item.json, sourceField)
        : typeof item.json === 'string'
          ? item.json
          : (item.json as Record<string, unknown>)?.html;
      const markdown = turndown.turndown(typeof raw === 'string' ? raw : '');
      const outJson: Record<string, unknown> = { ...item.json };
      setByPath(outJson, destinationField, markdown);
      return { json: outJson, binary: item.binary, pairedItem: item.pairedItem ?? { item: i } };
    });
    return { items: outItems };
  },
};

registerNode(markdownHtmlNode);
