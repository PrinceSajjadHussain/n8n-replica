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
}

function TreeRow({ node, nodeLabel, depth, onInsert }: TreeRowProps) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.children && node.children.length > 0;
  const indent = depth * 12;
  const expr = `{{$node["${nodeLabel}"].json.${node.path}}}`;

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
        />
      ))}
    </>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function SchemaTreeView({ nodeLabel, output, onInsert, className = '' }: Props) {
  // Normalise output: if it's an array of items (the worker's default batch
  // format), use the first item's json to derive the tree. If it's a plain
  // object, use it directly.
  const rootValue = (() => {
    if (!output) return null;
    if (Array.isArray(output) && output.length > 0) {
      const first = output[0];
      if (first && typeof first === 'object' && 'json' in (first as object)) {
        return (first as Record<string, unknown>).json;
      }
      return first;
    }
    if (typeof output === 'object' && output !== null && 'json' in output) {
      return (output as Record<string, unknown>).json;
    }
    return output;
  })();

  if (!rootValue || typeof rootValue !== 'object') {
    return (
      <div className={`text-[11px] text-muted px-2 py-3 ${className}`}>
        No output data yet — run the node first.
      </div>
    );
  }

  const roots = Object.entries(rootValue as Record<string, unknown>).map(([k, v]) =>
    buildTree(v, k, k, 0)
  );

  if (roots.length === 0) {
    return (
      <div className={`text-[11px] text-muted px-2 py-3 ${className}`}>
        Output is empty.
      </div>
    );
  }

  return (
    <div className={`flex flex-col py-1 ${className}`}>
      <div className="flex items-center justify-between px-2 pb-1 border-b border-panelBorder mb-1">
        <span className="text-[10px] uppercase tracking-widest text-muted">
          Output schema — {nodeLabel}
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
        />
      ))}
    </div>
  );
}
