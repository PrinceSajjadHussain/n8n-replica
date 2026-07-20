import { registerNode } from './types';
import type { NodePlugin } from './types';
import { setByPath } from '../engine/jsonPath';

/**
 * Move Binary Data — converts between an item's binary attachment and its
 * json representation. Distinct from Extract/Convert File (which handles
 * format conversion like PDF-to-text): this node only moves bytes between
 * the two "slots" an item has (binary vs json), same purpose as n8n's Move
 * Binary Data node.
 *
 * Modes:
 *   binaryToJson — decode a binary property (default "data") into a json
 *     field, either as a base64 string or, if `parseAsJson` is set, by
 *     JSON.parse-ing the decoded text (useful for a webhook that received
 *     a JSON payload as a raw binary body).
 *   jsonToBinary — encode a json field's value into a new binary
 *     attachment (stringifies non-string values first).
 *
 * params:
 *   { mode: 'binaryToJson' | 'jsonToBinary' }
 *   { binaryProperty?: string } — default "data"
 *   { jsonField?: string } — dot-path target/source field, default "data"
 *   { parseAsJson?: boolean } — binaryToJson only
 *   { mimeType?: string; fileName?: string } — jsonToBinary only
 */
export const moveBinaryDataNode: NodePlugin = {
  type: 'moveBinaryData',
  async execute({ items, params, getBinary, toBinary }) {
    const mode = params.mode === 'jsonToBinary' ? 'jsonToBinary' : 'binaryToJson';
    const binaryProperty = params.binaryProperty ? String(params.binaryProperty) : 'data';
    const jsonField = params.jsonField ? String(params.jsonField) : 'data';

    const outItems = items.map((item, i) => {
      if (mode === 'binaryToJson') {
        const buffer = getBinary(item, binaryProperty);
        const json = { ...item.json } as Record<string, unknown>;
        if (buffer) {
          const text = buffer.toString('utf8');
          if (params.parseAsJson) {
            try {
              setByPath(json, jsonField, JSON.parse(text));
            } catch {
              setByPath(json, jsonField, text); // fall back to raw text if not valid JSON
            }
          } else {
            setByPath(json, jsonField, buffer.toString('base64'));
          }
        }
        const remainingBinary = item.binary ? { ...item.binary } : undefined;
        if (remainingBinary) delete remainingBinary[binaryProperty];
        return { json, binary: remainingBinary, pairedItem: { item: i } };
      }

      // jsonToBinary
      const raw = (item.json as Record<string, unknown>)[jsonField];
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
      const buffer = Buffer.from(text, 'utf8');
      const binaryData = toBinary(buffer, String(params.mimeType || 'application/octet-stream'), params.fileName ? String(params.fileName) : undefined);
      return {
        json: item.json,
        binary: { ...(item.binary || {}), [binaryProperty]: binaryData },
        pairedItem: { item: i },
      };
    });

    return { items: outItems };
  },
};

registerNode(moveBinaryDataNode);
