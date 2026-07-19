import zlib from 'zlib';
import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * Compression — zip/unzip (via `jszip`, a new worker dependency added this
 * round — pure JS, no native bindings) and gzip/gunzip (Node's built-in
 * `zlib`, no dependency needed). Operates on binary data, following
 * `fileNode.ts`'s established `getBinary`/`toBinary` pattern rather than
 * `json`.
 *
 * ITEM-AWARE: runs once per item.
 *
 * params:
 *   operation: 'zip' | 'unzip' | 'gzip' | 'gunzip'   default 'gzip'
 *   binaryProperty?: string    input binary key to read, default 'data'
 *   destinationProperty?: string  output binary key to write, default 'data'
 *   fileName?: string          used by 'zip' as the single entry's name inside the
 *                                archive, default 'file'; used by 'gzip'/'unzip' as the
 *                                output attachment's file name
 *
 * 'unzip' only supports single-entry archives — it decompresses the first
 * file found in the zip and returns it as one output item's binary. A
 * multi-entry "one output item per archive entry" mode is a reasonable
 * follow-up but wasn't built this round (see README).
 */
export const compressionNode: NodePlugin = {
  type: 'compression',
  async execute({ items, params, getBinary, toBinary }) {
    const operation = String(params.operation ?? 'gzip');
    const binaryProperty = String(params.binaryProperty ?? 'data');
    const destinationProperty = String(params.destinationProperty ?? 'data');
    const fileName = params.fileName ? String(params.fileName) : undefined;

    const sourceItems = items.length > 0 ? items : [{ json: {} }];

    const outItems = await Promise.all(
      sourceItems.map(async (item, i) => {
        const buffer = getBinary(item, binaryProperty);
        if (!buffer) {
          throw new Error(`Compression node: no binary data found on item ${i} at property "${binaryProperty}"`);
        }

        let outBuffer: Buffer;
        let mimeType: string;
        let outName: string;

        if (operation === 'gzip') {
          outBuffer = zlib.gzipSync(buffer);
          mimeType = 'application/gzip';
          outName = fileName ?? `${item.binary?.[binaryProperty]?.fileName ?? 'file'}.gz`;
        } else if (operation === 'gunzip') {
          outBuffer = zlib.gunzipSync(buffer);
          mimeType = 'application/octet-stream';
          outName = fileName ?? (item.binary?.[binaryProperty]?.fileName ?? 'file').replace(/\.gz$/, '');
        } else if (operation === 'zip') {
          const JSZip = require('jszip');
          const zip = new JSZip();
          zip.file(fileName ?? item.binary?.[binaryProperty]?.fileName ?? 'file', buffer);
          outBuffer = await zip.generateAsync({ type: 'nodebuffer' });
          mimeType = 'application/zip';
          outName = fileName ? `${fileName}.zip` : 'archive.zip';
        } else if (operation === 'unzip') {
          const JSZip = require('jszip');
          const zip = await JSZip.loadAsync(buffer);
          const entries = Object.values(zip.files).filter((f: any) => !f.dir) as any[];
          if (entries.length === 0) throw new Error('Compression node: zip archive has no files');
          const first = entries[0];
          outBuffer = await first.async('nodebuffer');
          mimeType = 'application/octet-stream';
          outName = fileName ?? first.name;
        } else {
          throw new Error(`Compression node: unknown operation "${operation}" (expected zip/unzip/gzip/gunzip)`);
        }

        const binaryData = toBinary(outBuffer, mimeType, outName);
        return {
          json: { ...item.json, fileName: outName, mimeType, byteLength: outBuffer.length },
          binary: { ...item.binary, [destinationProperty]: binaryData },
          pairedItem: item.pairedItem ?? { item: i },
        };
      }),
    );

    return { items: outItems };
  },
};

registerNode(compressionNode);
