import axios from 'axios';
import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * HTTP Request node — makes a real outbound HTTP call.
 * params: {
 *   url: string, method?: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE', headers?: object, body?: unknown,
 *   downloadBinary?: boolean,   // if true, fetch the response as raw bytes and attach it as
 *                                // binary data (e.g. downloading an image/PDF) instead of parsing JSON
 *   binaryPropertyName?: string // key under item.binary to store the file (default: "data")
 * }
 * credential (optional type 'httpBearer'): { token: string } -> sent as Authorization: Bearer <token>
 */
export const httpRequestNode: NodePlugin = {
  type: 'httpRequest',
  async execute({ params, credential, toBinary }) {
    const url = String(params.url ?? '');
    if (!url) throw new Error('httpRequest node: "url" param is required');
    const method = String(params.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {
      ...(params.headers as Record<string, string> | undefined),
    };
    if (credential?.token) {
      headers.Authorization = `Bearer ${credential.token}`;
    }

    const downloadBinary = Boolean(params.downloadBinary);

    const response = await axios.request({
      url,
      method,
      headers,
      data: params.body,
      validateStatus: () => true, // let the workflow decide how to handle non-2xx
      timeout: 15000,
      responseType: downloadBinary ? 'arraybuffer' : 'json',
    });

    if (downloadBinary) {
      // Binary/file data as a first-class output: the response bytes travel
      // downstream as an item's `binary` property (never inlined into
      // `json`), so later nodes (Slack upload, Set, Code) can reference the
      // file without base64-bloating every expression/log line.
      const buffer = Buffer.from(response.data as ArrayBuffer);
      const mimeType = String(response.headers['content-type'] ?? 'application/octet-stream').split(';')[0];
      const urlPath = new URL(url).pathname;
      const fileName = urlPath.split('/').filter(Boolean).pop() || 'download';
      const binaryKey = String(params.binaryPropertyName ?? 'data');

      return {
        items: [
          {
            json: { status: response.status, headers: response.headers, url },
            binary: { [binaryKey]: toBinary(buffer, mimeType, fileName) },
          },
        ],
      };
    }

    return {
      output: {
        status: response.status,
        headers: response.headers,
        body: response.data,
      },
    };
  },
};

registerNode(httpRequestNode);
