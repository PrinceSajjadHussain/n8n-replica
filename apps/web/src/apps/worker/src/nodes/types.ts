/**
 * FlowForge Node Plugin Interface
 * ================================
 * Every node type (HTTP Request, IF, Code, Slack, etc.) implements this
 * interface and registers itself in the NODE_REGISTRY below. Adding a new
 * integration means: copy this template, implement `execute`, register it.
 * No changes to the execution engine are required.
 *
 * ITEM-PAIRING MODEL
 * -------------------
 * Data flows between nodes as an ARRAY OF ITEMS (`NodeItems`), each with its
 * own `json`, optional `binary` (file/image/PDF attachments), and
 * `pairedItem` lineage back to the input item it was derived from — the
 * same model n8n uses, replacing the old "single JSON blob per node"
 * approach.
 *
 * BACKWARD COMPATIBILITY
 * -----------------------
 * Existing plugins that only read `input`/return `output` keep working
 * unchanged: `input` is still handed to them as the "legacy" unwrapped
 * value (single object, or an array when there are multiple items), and
 * returning `{ output }` gets auto-normalized into items for you. Plugins
 * that want binary data or explicit item control should instead read
 * `items`/`getBinary()` and return `{ items }`.
 *
 * COPY-PASTE TEMPLATE FOR A NEW ITEM-AWARE NODE:
 * ------------------------------------------------------------------
 * export const myNewNode: NodePlugin = {
 *   type: 'myNewNode',
 *   async execute({ items, params, credential }) {
 *     const outItems = items.map((item, i) => ({
 *       json: { ...item.json, ok: true },
 *       binary: item.binary, // pass file data through untouched
 *       pairedItem: { item: i },
 *     }));
 *     return { items: outItems };
 *   },
 * };
 * NODE_REGISTRY['myNewNode'] = myNewNode;
 * ------------------------------------------------------------------
 */

import type { NodeItem, NodeItems, BinaryData } from '@flowforge/shared-types';

export interface NodeExecutionContext {
  /**
   * LEGACY: merged output(s) of upstream connected node(s), unwrapped from
   * the item model (single object if one item, array of json blobs if
   * many). Kept for existing node plugins — new plugins should prefer
   * `items`.
   */
  input: unknown;
  /** Full item-paired input: json + binary + lineage for every upstream item. */
  items: NodeItems;
  /** This node's configured parameters (from the workflow JSON). */
  params: Record<string, unknown>;
  /** Decrypted credential data, if this node has a credentialId configured. */
  credential: Record<string, unknown> | null;
  /** Decodes a named binary property (default: "data") on an item to a Buffer, or null if absent. */
  getBinary(item: NodeItem, key?: string): Buffer | null;
  /** Builds a BinaryData object from raw bytes — base64-encodes and fills in fileSize. */
  toBinary(buffer: Buffer, mimeType: string, fileName?: string): BinaryData;
}

export interface NodeExecutionResult {
  /**
   * LEGACY: JSON-serializable output passed to downstream nodes. Ignored if
   * `items` is provided. Auto-normalized into `NodeItems` by the executor
   * (array -> one item per element, object -> single item).
   */
  output?: unknown;
  /** Preferred: explicit items (json + binary + pairedItem) to pass downstream. */
  items?: NodeItems;
  /**
   * For branching nodes (IF/Switch): which outgoing edge handle to follow.
   * Edges whose `sourceHandle` doesn't match are not traversed (and their
   * downstream-only nodes are marked 'skipped').
   */
  branch?: string;
}

export interface NodePlugin {
  type: string;
  execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult>;
}

export const NODE_REGISTRY: Record<string, NodePlugin> = {};

export function registerNode(plugin: NodePlugin): void {
  NODE_REGISTRY[plugin.type] = plugin;
}

// ---------------------------------------------------------------------------
// Item <-> legacy-value normalization helpers, shared by the executor and
// any plugin/test-runner that needs to convert between the two shapes.
// ---------------------------------------------------------------------------

/** True if `value` already looks like a NodeItems array (every element has a `json` object). */
export function isItemsShape(value: unknown): value is NodeItems {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => v && typeof v === 'object' && 'json' in (v as object) && !Array.isArray((v as any).json))
  );
}

/**
 * Normalizes an arbitrary legacy value (single object, array of objects, or
 * already-items) into `NodeItems`. `sourceNodeId` is stamped onto
 * `pairedItem` for lineage tracking.
 */
export function normalizeToItems(value: unknown, sourceNodeId?: string): NodeItems {
  if (value == null) {
    return [{ json: {}, pairedItem: { item: 0, sourceNode: sourceNodeId } }];
  }
  if (isItemsShape(value)) {
    return (value as NodeItems).map((it, i) => ({
      json: it.json ?? {},
      binary: it.binary,
      pairedItem: it.pairedItem ?? { item: i, sourceNode: sourceNodeId },
    }));
  }
  if (Array.isArray(value)) {
    return value.map((el, i) => ({
      json: el && typeof el === 'object' && !Array.isArray(el) ? (el as Record<string, unknown>) : { value: el },
      pairedItem: { item: i, sourceNode: sourceNodeId },
    }));
  }
  if (typeof value === 'object') {
    return [{ json: value as Record<string, unknown>, pairedItem: { item: 0, sourceNode: sourceNodeId } }];
  }
  // primitive
  return [{ json: { value }, pairedItem: { item: 0, sourceNode: sourceNodeId } }];
}

/**
 * Collapses `NodeItems` back down to the legacy unwrapped shape a
 * not-yet-upgraded plugin (or an expression's `$json`) expects: the single
 * item's `json` if there's exactly one item, an array of `json` blobs
 * otherwise, or `null` for zero items.
 */
export function itemsToLegacyValue(items: NodeItems): unknown {
  if (!items || items.length === 0) return null;
  if (items.length === 1) return items[0].json;
  return items.map((i) => i.json);
}

/** Decodes a named binary property to a Buffer, or null if missing/inline data absent. */
export function decodeBinary(item: NodeItem | undefined, key = 'data'): Buffer | null {
  const bin = item?.binary?.[key];
  if (!bin?.data) return null;
  return Buffer.from(bin.data, 'base64');
}

/** Builds a BinaryData object (base64-encoded) from raw bytes. */
export function makeBinary(buffer: Buffer, mimeType: string, fileName?: string): BinaryData {
  return {
    mimeType,
    fileName,
    fileExtension: fileName?.includes('.') ? fileName.split('.').pop() : undefined,
    fileSize: buffer.length,
    data: buffer.toString('base64'),
  };
}
