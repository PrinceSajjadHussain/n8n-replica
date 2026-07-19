import { registerNode } from './types';
import type { NodePlugin } from './types';
import { getByPath, setByPath } from '../engine/jsonPath';

/**
 * XML <-> JSON — bidirectional conversion node using `fast-xml-parser`
 * (new worker dependency, added this round — pure JS, no native bindings,
 * has both a parser and a builder so one package covers both directions).
 *
 * ITEM-AWARE: runs once per item.
 *
 * params:
 *   direction: 'toJson' | 'toXml'    default 'toJson'
 *   sourceField?: string              dot-path to the input string (toJson) or
 *                                      object (toXml); defaults to the whole
 *                                      item json if it's already the right shape
 *   destinationField?: string         default 'json' or 'xml' to match direction
 *   rootName?: string                 root element name for toXml, default 'root'
 */
export const xmlJsonNode: NodePlugin = {
  type: 'xmlJson',
  async execute({ items, params }) {
    const direction = params.direction === 'toXml' ? 'toXml' : 'toJson';
    const sourceField = params.sourceField ? String(params.sourceField) : '';
    const destinationField = params.destinationField
      ? String(params.destinationField)
      : direction === 'toJson'
        ? 'json'
        : 'xml';

    const sourceItems = items.length > 0 ? items : [{ json: {} }];

    if (direction === 'toJson') {
      const { XMLParser } = require('fast-xml-parser');
      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
      const outItems = sourceItems.map((item, i) => {
        const raw = sourceField
          ? getByPath(item.json, sourceField)
          : typeof item.json === 'string'
            ? item.json
            : (item.json as Record<string, unknown>)?.xml;
        const parsed = parser.parse(typeof raw === 'string' ? raw : '');
        const outJson: Record<string, unknown> = { ...item.json };
        setByPath(outJson, destinationField, parsed);
        return { json: outJson, binary: item.binary, pairedItem: item.pairedItem ?? { item: i } };
      });
      return { items: outItems };
    }

    const { XMLBuilder } = require('fast-xml-parser');
    const rootName = String(params.rootName ?? 'root');
    const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', format: true });
    const outItems = sourceItems.map((item, i) => {
      const raw = sourceField ? getByPath(item.json, sourceField) : item.json;
      const obj = raw && typeof raw === 'object' ? raw : { value: raw };
      const xml = builder.build({ [rootName]: obj }) as string;
      const outJson: Record<string, unknown> = { ...item.json };
      setByPath(outJson, destinationField, xml);
      return { json: outJson, binary: item.binary, pairedItem: item.pairedItem ?? { item: i } };
    });
    return { items: outItems };
  },
};

registerNode(xmlJsonNode);
