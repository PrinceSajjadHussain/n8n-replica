/**
 * SchemaTreeView — derives a field tree from a node's last-run output JSON
 * entirely client-side (no separate backend "schema" endpoint needed —
 * matches n8n's VirtualSchema.vue approach from audit section 18).
 *
 * Clicking or dragging a field inserts an `{{$node["Label"].json.path}}`
 * expression reference into the focused param input. This is the
 * drag-to-insert / click-to-copy wiring referenced in Fix 6.
 *
 * Usage:
 *   <SchemaTreeView
 *     nodeLabel="HTTP Request"
 *     output={node.data.lastRunOutput}
 *     onInsert={(expr) => pasteIntoFocusedInput(expr)}
 *   />
 */

import { useState } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

interface SchemaNode {
  key: string;
  path: string;      // dot-notation path from root, e.g. "body.items[0].id"
  value: unknown;
  type: string;      // "string" | "number" | "boolean" | "object" | "array" | "null"
  children?: SchemaNode[];
  isLeaf: boolean;
}

interface Props {
  /** Label of the node whose output we're showing — used to build $node["Label"] expressions. */
  nodeLabel: string;
  /** The node's last-run output (from FlowNodeData.lastRunOutput). May be an array of items. */
  output: unknown;
  /**
   * Called when the user clicks or drag-drops a field.
   * The expression string is ready to be pasted, e.g.
   * `{{$node["HTTP Request"].json.body.id}}`
   */
  onInsert?: (expression: string) => void;
  className?: string;
  /**
   * Which reference root the built expression should use.
   * "output" (default) -> $node["Label"].json.path — for referencing this node's own tested result
   * "input"  -> $json.path — for referencing the item currently flowing into this node
   */
  refKind?: 'output' | 'input';
  /** Which sub-view is active — drives whether we render the field tree or a spreadsheet-style table. */
  view?: 'schema' | 'table';
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function typeColor(type: string): string {
  switch (type) {
    case 'string':  return 'text-signal';
    case 'number':  return 'text-amber';
    case 'boolean': return 'text-fuchsia-400';
    case 'null':    return 'text-muted';
    case 'array':   return 'text-sky-400';
    case 'object':  return 'text-sky-400';
    default:        return 'text-ink';
  }
}

function typeLabel(type: string): string {
  return type.slice(0, 3); // "str", "num", "boo", "nul", "arr", "obj"
}

/** Recursively build the schema tree from a value. */
function buildTree(value: unknown, key: string, parentPath: string, depth: number): SchemaNode {
  const path = parentPath ? `${parentPath}.${key}` : key;
  const type = typeOf(value);

  if (type === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    // Cap depth to avoid rendering enormous trees
    const children = depth < 5
      ? entries.map(([k, v]) => buildTree(v, k, path, depth + 1))
      : [];
    return { key, path, value, type, children, isLeaf: entries.length === 0 || depth >= 5 };
  }

  if (type === 'array') {
    const arr = value as unknown[];
    // Show the first item's schema as representative, plus an [n] count
    const firstChild = arr.length > 0 && depth < 5
      ? [buildTree(arr[0], '[0]', path, depth + 1)]
      : [];
    return { key, path, value, type, children: firstChild, isLeaf: arr.length === 0 || depth >= 5 };
  }

  return { key, path, value, type, isLeaf: true };
}

/** Build a compact preview of a scalar value. */
function previewValue(value: unknown, type: string): string {
  if (type === 'null') return 'null';
  if (type === 'boolean') return String(value);
  if (type === 'number') return String(value);
  if (type === 'string') {
    const s = String(value);
    return s.length > 40 ? `"${s.slice(0, 40)}…"` : `"${s}"`;
  }
  return '';
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface TreeRowProps {
  node: SchemaNode;
  nodeLabel: string;
  depth: number;
  onInsert?: (expr: string) => void;
  refKind?: 'output' | 'input';
}

/** Builds the `{{ }}` expression for a field path, rooted at either this node's own tested output ($node["Label"].json.*) or the item currently flowing into it ($json.*). */
function buildExpr(nodeLabel: string, path: string, refKind: 'output' | 'input' = 'output'): string {
  return refKind === 'input' ? `{{$json.${path}}}` : `{{$node["${nodeLabel}"].json.${path}}}`;
}

function TreeRow({ node, nodeLabel, depth, onInsert, refKind = 'output' }: TreeRowProps) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.children && node.children.length > 0;
  const indent = depth * 12;
  const expr = buildExpr(nodeLabel, node.path, refKind);

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData('text/plain', expr);
    e.dataTransfer.effectAllowed = 'copy';
  }

  return (
    <>
      <div
        className="group flex items-center gap-1 py-0.5 px-2 rounded hover:bg-canvas cursor-pointer select-none"
        style={{ paddingLeft: `${8 + indent}px` }}
        draggable
        onDragStart={handleDragStart}
        onClick={() => {
          if (hasChildren) {
            setOpen((v) => !v);
          } else {
            onInsert?.(expr);
          }
        }}
      >
        {/* Expand/collapse chevron */}
        <span className="w-3 shrink-0 text-muted text-[10px]">
          {hasChildren ? (open ? '▾' : '▸') : ''}
        </span>

        {/* Key name */}
        <span className="text-[11px] text-ink font-display truncate flex-1">{node.key}</span>

        {/* Type badge */}
        <span className={`shrink-0 text-[9px] uppercase tracking-wide ${typeColor(node.type)}`}>
          {typeLabel(node.type)}
        </span>

        {/* Scalar value preview */}
        {node.isLeaf && (
          <span className="shrink-0 text-[10px] text-muted ml-1 max-w-[100px] truncate">
            {previewValue(node.value, node.type)}
          </span>
        )}

        {/* Insert-expression button (always visible on hover for leaf nodes) */}
        {node.isLeaf && onInsert && (
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onInsert(expr);
            }}
            className="focus-ring opacity-0 group-hover:opacity-100 shrink-0 text-[9px] px-1 py-0.5 rounded border border-panelBorder text-muted hover:text-signal hover:border-signal/40 ml-1"
            title={`Insert: ${expr}`}
          >
            ↗
          </button>
        )}
      </div>

      {/* Children */}
      {hasChildren && open && node.children!.map((child) => (
        <TreeRow
          key={child.path}
          node={child}
          nodeLabel={nodeLabel}
          depth={depth + 1}
          onInsert={onInsert}
          refKind={refKind}
        />
      ))}
    </>
  );
}

// ─── Table view ─────────────────────────────────────────────────────────────

/** Extracts the list of `.json` payloads from an output value, regardless of whether it's a raw array of items ({json,binary}), a bare array of objects, or a single object. */
function extractItemsList(output: unknown): Record<string, unknown>[] {
  if (!output) return [];
  if (Array.isArray(output)) {
    return output.map((entry) => {
      if (entry && typeof entry === 'object' && 'json' in (entry as object)) {
        return (entry as Record<string, unknown>).json as Record<string, unknown>;
      }
      return entry as Record<string, unknown>;
    });
  }
  if (typeof output === 'object' && output !== null) {
    if ('json' in (output as object)) return [(output as Record<string, unknown>).json as Record<string, unknown>];
    return [output as Record<string, unknown>];
  }
  return [];
}

/** Union of every top-level key across all items, in first-seen order — mirrors n8n's Table view column derivation for heterogeneous item arrays. */
function collectColumns(items: Record<string, unknown>[]): string[] {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    for (const k of Object.keys(item)) {
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  return cols;
}

function cellPreview(value: unknown): string {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'string') return value.length > 60 ? `${value.slice(0, 60)}…` : value;
  if (typeof value === 'object') {
    try {
      const s = JSON.stringify(value);
      return s.length > 60 ? `${s.slice(0, 60)}…` : s;
    } catch {
      return String(value);
    }
  }
  return String(value);
}

interface TableViewProps {
  items: Record<string, unknown>[];
  nodeLabel: string;
  refKind?: 'output' | 'input';
  onInsert?: (expr: string) => void;
}

/** Spreadsheet-style rendering of every item, matching n8n's "Table" tab. Each cell is click/drag-insertable, addressed as an indexed path (e.g. `[2].email`) when there's more than one item, or a bare field path for a single item — mirroring how $json resolves per-item during execution. */
function TableView({ items, nodeLabel, refKind = 'output', onInsert }: TableViewProps) {
  if (items.length === 0) {
    return <div className="text-[11px] text-muted px-2 py-3">No data yet — click "▶ Run this node in isolation" below to generate output, then fields appear here for drag-to-insert.</div>;
  }
  const columns = collectColumns(items);
  if (columns.length === 0) {
    return <div className="text-[11px] text-muted px-2 py-3">Output is empty.</div>;
  }

  function cellExpr(rowIdx: number, col: string): string {
    const path = items.length > 1 ? `[${rowIdx}].${col}` : col;
    return buildExpr(nodeLabel, path, refKind);
  }

  function handleDragStart(e: React.DragEvent, expr: string) {
    e.dataTransfer.setData('text/plain', expr);
    e.dataTransfer.effectAllowed = 'copy';
  }

  return (
    <div className="overflow-auto max-h-64">
      <table className="text-[11px] border-collapse w-full">
        <thead>
          <tr className="sticky top-0 bg-panel">
            <th className="text-left text-muted font-display px-2 py-1 border-b border-panelBorder w-8">#</th>
            {columns.map((col) => (
              <th key={col} className="text-left text-ink font-display px-2 py-1 border-b border-panelBorder whitespace-nowrap">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, rowIdx) => (
            <tr key={rowIdx} className="hover:bg-canvas">
              <td className="px-2 py-1 text-muted border-b border-panelBorder/60">{rowIdx}</td>
              {columns.map((col) => {
                const expr = cellExpr(rowIdx, col);
                return (
                  <td
                    key={col}
                    draggable
                    onDragStart={(e) => handleDragStart(e, expr)}
                    onClick={() => onInsert?.(expr)}
                    title={`Insert: ${expr}`}
                    className="px-2 py-1 border-b border-panelBorder/60 whitespace-nowrap cursor-pointer hover:bg-signal/10 font-display"
                  >
                    {cellPreview(item?.[col])}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function SchemaTreeView({
  nodeLabel,
  output,
  onInsert,
  className = '',
  refKind = 'output',
  view = 'schema',
}: Props) {
  const allItems = extractItemsList(output);
  const rootValue = allItems[0];

  const label = refKind === 'input' ? 'Input' : 'Output';

  if (view === 'table') {
    return (
      <div className={`flex flex-col py-1 ${className}`}>
        <div className="flex items-center justify-between px-2 pb-1 border-b border-panelBorder mb-1">
          <span className="text-[10px] uppercase tracking-widest text-muted">
            {label} — {allItems.length} item{allItems.length === 1 ? '' : 's'}
          </span>
          {onInsert && <span className="text-[9px] text-muted">click or drag a cell to insert</span>}
        </div>
        <TableView items={allItems} nodeLabel={nodeLabel} refKind={refKind} onInsert={onInsert} />
      </div>
    );
  }

  if (!rootValue || typeof rootValue !== 'object') {
    return (
      <div className={`text-[11px] text-muted px-2 py-3 ${className}`}>
        No {label.toLowerCase()} data yet — run the node in isolation below to populate this.
      </div>
    );
  }

  const roots = Object.entries(rootValue as Record<string, unknown>).map(([k, v]) =>
    buildTree(v, k, k, 0)
  );

  if (roots.length === 0) {
    return (
      <div className={`text-[11px] text-muted px-2 py-3 ${className}`}>
        {label} is empty.
      </div>
    );
  }

  return (
    <div className={`flex flex-col py-1 ${className}`}>
      <div className="flex items-center justify-between px-2 pb-1 border-b border-panelBorder mb-1">
        <span className="text-[10px] uppercase tracking-widest text-muted">
          {label} schema — {nodeLabel}
          {allItems.length > 1 && <span className="text-muted normal-case"> (showing item 0 of {allItems.length})</span>}
        </span>
        {onInsert && (
          <span className="text-[9px] text-muted">drag or click ↗ to insert</span>
        )}
      </div>
      {roots.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          nodeLabel={nodeLabel}
          depth={0}
          onInsert={onInsert}
          refKind={refKind}
        />
      ))}
    </div>
  );
}
