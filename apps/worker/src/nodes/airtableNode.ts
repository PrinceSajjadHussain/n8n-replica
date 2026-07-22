import axios from 'axios';
import { registerNode } from './types';
import type { NodePlugin } from './types';
import { wrapIntegrationError } from './integrationErrors';

/**
 * airtable — real core node (previously only an illustrative
 * marketplace/npm entry — see docs/integration-progress.md's "Airtable"
 * row and apps/api/src/marketplace/registryIndex.ts, which is now removed
 * from there since this is a real built-in node).
 *
 * credential (type 'airtable'): { apiKey: string }
 *   Personal access token from https://airtable.com/create/tokens, needs
 *   at minimum data.records:read (and data.records:write for
 *   create/update/upsert/delete) scope on the target base.
 *
 * params:
 *   action: 'list' | 'get' | 'create' | 'update' | 'upsert' | 'delete'   (default 'list')
 *   baseId: string        (required — starts with "app...")
 *   table: string          (required — table name or id)
 *   recordId?: string      (get, update, delete)
 *   fields?: object         (create, update — { fieldName: value, ... })
 *   matchField?: string     (upsert — field name to match an existing record on)
 *   matchValue?: unknown    (upsert — value to match matchField against)
 *   view?: string           (list — named view to read from)
 *   filterByFormula?: string (list — Airtable formula string)
 *   maxRecords?: number      (list — default 100, capped at Airtable's own 100/page;
 *                              this node follows `offset` automatically up to maxRecords)
 *   sort?: { field: string; direction?: 'asc' | 'desc' }[]   (list)
 */
export const airtableNode: NodePlugin = {
  type: 'airtable',
  async execute({ params, credential }) {
    const apiKey = credential?.apiKey as string | undefined;
    if (!apiKey) throw new Error('airtable node: requires an "airtable" credential with { "apiKey" }');

    const baseId = String(params.baseId ?? '');
    const table = String(params.table ?? '');
    if (!baseId) throw new Error('airtable node: params.baseId is required');
    if (!table) throw new Error('airtable node: params.table is required');

    const action = String(params.action ?? 'list');
    const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    const base = `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(table)}`;

    try {
      switch (action) {
        case 'list': {
          const maxRecords = Number(params.maxRecords ?? 100);
          const records: unknown[] = [];
          let offset: string | undefined;
          do {
            const response = await axios.get(base, {
              headers,
              timeout: 15_000,
              params: {
                view: params.view || undefined,
                filterByFormula: params.filterByFormula || undefined,
                pageSize: Math.min(100, maxRecords - records.length),
                offset,
                ...(Array.isArray(params.sort)
                  ? Object.fromEntries(
                      (params.sort as { field: string; direction?: string }[]).flatMap((s, i) => [
                        [`sort[${i}][field]`, s.field],
                        [`sort[${i}][direction]`, s.direction ?? 'asc'],
                      ])
                    )
                  : {}),
              },
            });
            records.push(...(response.data?.records ?? []));
            offset = response.data?.offset;
          } while (offset && records.length < maxRecords);
          return { items: records.slice(0, maxRecords).map((r, i) => ({ json: r as object, pairedItem: { item: i } })) };
        }

        case 'get': {
          const recordId = String(params.recordId ?? '');
          if (!recordId) throw new Error('airtable node: "get" requires params.recordId');
          const response = await axios.get(`${base}/${encodeURIComponent(recordId)}`, { headers, timeout: 15_000 });
          return { output: response.data };
        }

        case 'create': {
          const fields = (params.fields as Record<string, unknown>) ?? {};
          const response = await axios.post(base, { fields }, { headers, timeout: 15_000 });
          return { output: response.data };
        }

        case 'update': {
          const recordId = String(params.recordId ?? '');
          if (!recordId) throw new Error('airtable node: "update" requires params.recordId');
          const fields = (params.fields as Record<string, unknown>) ?? {};
          const response = await axios.patch(`${base}/${encodeURIComponent(recordId)}`, { fields }, { headers, timeout: 15_000 });
          return { output: response.data };
        }

        case 'upsert': {
          const matchField = String(params.matchField ?? '');
          if (!matchField) throw new Error('airtable node: "upsert" requires params.matchField');
          const matchValue = params.matchValue;
          const escaped = String(matchValue).replace(/"/g, '\\"');
          const formula = `{${matchField}} = "${escaped}"`;
          const lookup = await axios.get(base, {
            headers,
            timeout: 15_000,
            params: { filterByFormula: formula, maxRecords: 1 },
          });
          const existing = lookup.data?.records?.[0];
          const fields = (params.fields as Record<string, unknown>) ?? {};
          if (existing) {
            const response = await axios.patch(`${base}/${encodeURIComponent(existing.id)}`, { fields }, { headers, timeout: 15_000 });
            return { output: { ...response.data, matched: true } };
          }
          const response = await axios.post(base, { fields: { ...fields, [matchField]: matchValue } }, { headers, timeout: 15_000 });
          return { output: { ...response.data, matched: false } };
        }

        case 'delete': {
          const recordId = String(params.recordId ?? '');
          if (!recordId) throw new Error('airtable node: "delete" requires params.recordId');
          const response = await axios.delete(`${base}/${encodeURIComponent(recordId)}`, { headers, timeout: 15_000 });
          return { output: response.data };
        }

        default:
          throw new Error(`airtable node: unknown action "${action}"`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('airtable node:')) throw err;
      throw wrapIntegrationError('airtable', err);
    }
  },
};

registerNode(airtableNode);
