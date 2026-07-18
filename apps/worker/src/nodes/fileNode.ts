import { registerNode, decodeBinary, makeBinary } from './types';
import type { NodePlugin } from './types';
import type { NodeItem } from '@flowforge/shared-types';

/**
 * Generic file utility nodes — the built-in "binary data <-> items" bridge
 * that n8n ships (its "Extract from File" / "Convert to File" nodes), so
 * workflows can turn an upstream binary attachment (CSV/JSON/plain text)
 * into structured items, or flatten items back down into a downloadable
 * file, without a bespoke integration node for each format.
 */

function csvParseSync(buffer: Buffer): Record<string, string>[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { parse } = require('csv-parse/sync');
  return parse(buffer, { columns: true, skip_empty_lines: true, trim: true });
}

/** Minimal CSV writer: quotes any field containing a comma, quote, or newline. */
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const columns = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((k) => set.add(k));
    return set;
  }, new Set<string>()));

  const escape = (value: unknown): string => {
    const s = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [columns.map(escape).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => escape(row[c])).join(','));
  }
  return lines.join('\n');
}

/**
 * Extract from File — reads a named binary property off each input item and
 * parses it into item(s), replacing the item's `json` with the parsed
 * content:
 *   - csv:   one output item per row, `json` = that row's columns
 *   - json:  parsed value becomes `json` (array -> one item per element,
 *            object -> single item)
 *   - text:  `json` = { text: <decoded utf8 string> }
 *
 * params: { binaryProperty?: string (default "data"), format: 'csv' | 'json' | 'text', dropBinary?: boolean }
 */
export const fileExtractNode: NodePlugin = {
  type: 'fileExtract',
  async execute({ items, params }) {
    const binaryProperty = String(params.binaryProperty ?? 'data');
    const format = String(params.format ?? 'csv');
    const dropBinary = Boolean(params.dropBinary);

    const sourceItems = items.length > 0 ? items : [{ json: {} } as NodeItem];
    const outItems: NodeItem[] = [];

    sourceItems.forEach((item, i) => {
      const buffer = decodeBinary(item, binaryProperty);
      if (!buffer) {
        throw new Error(
          `Extract from File: item ${i} has no binary property "${binaryProperty}" to read (did an upstream node attach a file?)`
        );
      }
      const carryBinary = dropBinary ? undefined : item.binary;

      if (format === 'csv') {
        const rows = csvParseSync(buffer);
        rows.forEach((row) => {
          outItems.push({ json: row, binary: carryBinary, pairedItem: { item: i } });
        });
        if (rows.length === 0) {
          outItems.push({ json: {}, binary: carryBinary, pairedItem: { item: i } });
        }
      } else if (format === 'json') {
        const parsed = JSON.parse(buffer.toString('utf8'));
        if (Array.isArray(parsed)) {
          parsed.forEach((el) => {
            outItems.push({
              json: el && typeof el === 'object' ? el : { value: el },
              binary: carryBinary,
              pairedItem: { item: i },
            });
          });
        } else {
          outItems.push({ json: parsed ?? {}, binary: carryBinary, pairedItem: { item: i } });
        }
      } else if (format === 'text') {
        outItems.push({ json: { text: buffer.toString('utf8') }, binary: carryBinary, pairedItem: { item: i } });
      } else {
        throw new Error(`Extract from File: unknown format "${format}" (expected csv/json/text)`);
      }
    });

    return { items: outItems };
  },
};
registerNode(fileExtractNode);

/**
 * Convert to File — flattens all input items' `json` into a single binary
 * attachment on one output item (CSV or JSON), so it can be sent onward
 * (email attachment, HTTP upload, Slack file, etc.) or downloaded via
 * "Respond to Webhook".
 *
 * params: { format: 'csv' | 'json', fileName?: string, binaryProperty?: string (default "data") }
 */
export const fileConvertNode: NodePlugin = {
  type: 'fileConvert',
  async execute({ items, params, toBinary }) {
    const format = String(params.format ?? 'csv');
    const binaryProperty = String(params.binaryProperty ?? 'data');
    const rows = items.map((i) => i.json);

    let buffer: Buffer;
    let mimeType: string;
    let defaultName: string;

    if (format === 'csv') {
      buffer = Buffer.from(toCsv(rows), 'utf8');
      mimeType = 'text/csv';
      defaultName = 'export.csv';
    } else if (format === 'json') {
      const payload = rows.length === 1 ? rows[0] : rows;
      buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
      mimeType = 'application/json';
      defaultName = 'export.json';
    } else {
      throw new Error(`Convert to File: unknown format "${format}" (expected csv/json)`);
    }

    const fileName = params.fileName ? String(params.fileName) : defaultName;
    const binaryData = toBinary(buffer, mimeType, fileName);

    return {
      items: [
        {
          json: { fileName, mimeType, itemCount: rows.length },
          binary: { [binaryProperty]: binaryData },
          pairedItem: items.map((_, i) => ({ item: i })),
        },
      ],
    };
  },
};
registerNode(fileConvertNode);
