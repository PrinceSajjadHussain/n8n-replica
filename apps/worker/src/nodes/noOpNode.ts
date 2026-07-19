import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * NoOp — pass-through node. Passes items through completely unchanged
 * (json + binary + pairedItem). Useful as a canvas anchor point (e.g. a
 * single node several branches can point at before continuing, or a
 * placeholder while sketching out a workflow) — same purpose as n8n/Make's
 * NoOp node.
 */
export const noOpNode: NodePlugin = {
  type: 'noOp',
  async execute({ items }) {
    return { items };
  },
};

registerNode(noOpNode);
