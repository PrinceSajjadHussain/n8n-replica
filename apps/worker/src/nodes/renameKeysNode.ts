import { registerNode } from './types';
import type { NodePlugin } from './types';
import { getByPath, setByPath } from '../engine/jsonPath';

/**
 * Rename Keys — bulk-renames fields on each item's json via a list of
 * from/to dot-notation paths. Distinct from Set/Edit Fields: Set adds or
 * overwrites values at fixed paths, Rename Keys relocates existing values
 * to a new path (and removes them from the old one) without touching the
 * value itself. Same purpose as n8n's Rename Keys node.
 *
 * params:
 *   { mappings: { from: string; to: string }[] }
 *   { removeOthers?: boolean } — when true, output only the renamed fields
 *     (default false: all other fields pass through untouched)
 */
export const renameKeysNode: NodePlugin = {
  type: 'renameKeys',
  async execute({ items, params }) {
    const mappings = Array.isArray(params.mappings)
      ? (params.mappings as { from?: unknown; to?: unknown }[])
          .map((m) => ({ from: String(m.from ?? '').trim(), to: String(m.to ?? '').trim() }))
          .filter((m) => m.from && m.to)
      : [];
    const removeOthers = Boolean(params.removeOthers);

    const outItems = items.map((item, i) => {
      const source = item.json as Record<string, unknown>;
      const target: Record<string, unknown> = removeOthers ? {} : { ...source };

      for (const { from, to } of mappings) {
        const value = getByPath(source, from);
        if (value === undefined) continue;
        setByPath(target, to, value);
        if (!removeOthers && from !== to) {
          // Remove the old top-level key if it was a simple (non-nested) rename.
          if (!from.includes('.')) delete target[from];
        }
      }

      return {
        json: target,
        binary: item.binary,
        pairedItem: { item: i },
      };
    });

    return { items: outItems };
  },
};

registerNode(renameKeysNode);
