import axios from 'axios';
import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * HTTP Request node — makes a real outbound HTTP call.
 * params: { url: string, method?: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE', headers?: object, body?: unknown }
 * credential (optional type 'httpBearer'): { token: string } -> sent as Authorization: Bearer <token>
 */
export const httpRequestNode: NodePlugin = {
  type: 'httpRequest',
  async execute({ params, credential }) {
    const url = String(params.url ?? '');
    if (!url) throw new Error('httpRequest node: "url" param is required');
    const method = String(params.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {
      ...(params.headers as Record<string, string> | undefined),
    };
    if (credential?.token) {
      headers.Authorization = `Bearer ${credential.token}`;
    }

    const response = await axios.request({
      url,
      method,
      headers,
      data: params.body,
      validateStatus: () => true, // let the workflow decide how to handle non-2xx
      timeout: 15000,
    });

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
