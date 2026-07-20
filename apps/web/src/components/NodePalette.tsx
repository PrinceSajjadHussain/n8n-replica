import { useEffect, useMemo, useState } from 'react';
import { NODE_TYPES, NODE_CATEGORIES, CATEGORY_META, type NodeTypeMeta } from '../lib/nodeTypeMeta';
import NodeIcon from './NodeIcon';

const RECENTLY_USED_KEY = 'flowforge:node-palette:recently-used';
const RECENTLY_USED_LIMIT = 6;

/** Fuzzy subsequence match: every char of `query` must appear in `text`, in order (not necessarily contiguous). */
function fuzzyMatches(text: string, query: string): boolean {
  let ti = 0;
  for (let qi = 0; qi < query.length; qi++) {
    const ch = query[qi];
    let found = false;
    while (ti < text.length) {
      if (text[ti] === ch) {
        found = true;
        ti++;
        break;
      }
      ti++;
    }
    if (!found) return false;
  }
  return true;
}

function loadRecentlyUsed(): string[] {
  try {
    const raw = localStorage.getItem(RECENTLY_USED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function pushRecentlyUsed(type: string) {
  try {
    const current = loadRecentlyUsed().filter((t) => t !== type);
    current.unshift(type);
    localStorage.setItem(RECENTLY_USED_KEY, JSON.stringify(current.slice(0, RECENTLY_USED_LIMIT)));
  } catch {
    // localStorage unavailable (private mode, etc.) — recently-used is a nicety, safe to skip.
  }
}

/** A single colored icon tile, reused for both the grid and the recently-used row. */
function NodeTile({
  node,
  onAdd,
  dimmed,
}: {
  node: NodeTypeMeta;
  onAdd: (node: NodeTypeMeta) => void;
  dimmed?: boolean;
}) {
  return (
    <button
      onClick={() => onAdd(node)}
      title={dimmed ? `${node.label} — doesn't have a matching port for this connection` : node.label}
      className={`focus-ring group flex flex-col items-center gap-1.5 p-2 rounded-lg hover:bg-canvas transition text-center ${
        dimmed ? 'opacity-35 grayscale hover:opacity-70 hover:grayscale-0' : ''
      }`}
    >
      <span
        className="w-9 h-9 rounded-lg flex items-center justify-center leading-none shadow-sm group-hover:scale-105 transition-transform"
        style={{ background: `${node.color}22`, color: node.color, border: `1px solid ${node.color}55` }}
      >
        <NodeIcon type={node.type} size={18} />
      </span>
      <span className="text-[10.5px] text-ink leading-tight line-clamp-2">{node.label}</span>
    </button>
  );
}

export default function NodePalette({
  onAdd,
  compatibleTypes,
}: {
  onAdd: (type: string, label: string) => void;
  /**
   * When set (a pending handle-add request is active), node types NOT in
   * this set are dimmed rather than hidden — the user can still add them
   * bare, but the useful matches are visually obvious. `undefined` means no
   * filter is active (normal palette browsing).
   */
  compatibleTypes?: Set<string>;
}) {
  const [query, setQuery] = useState('');
  const [recentTypes, setRecentTypes] = useState<string[]>([]);

  useEffect(() => {
    setRecentTypes(loadRecentlyUsed());
  }, []);

  function handleAdd(node: NodeTypeMeta) {
    onAdd(node.type, node.label);
    pushRecentlyUsed(node.type);
    setRecentTypes(loadRecentlyUsed());
  }

  const trimmedQuery = query.trim().toLowerCase();
  const filteredNodes = useMemo(() => {
    if (!trimmedQuery) return NODE_TYPES;
    // Prefer plain substring matches (more predictable), fall back to fuzzy subsequence matches.
    const substring = NODE_TYPES.filter(
      (n) =>
        n.label.toLowerCase().includes(trimmedQuery) ||
        n.type.toLowerCase().includes(trimmedQuery) ||
        n.category.toLowerCase().includes(trimmedQuery)
    );
    if (substring.length > 0) return substring;
    return NODE_TYPES.filter((n) => fuzzyMatches(n.label.toLowerCase(), trimmedQuery));
  }, [trimmedQuery]);

  const presentCategories = NODE_CATEGORIES.filter((cat) => filteredNodes.some((n) => n.category === cat));
  const recentNodes = recentTypes
    .map((type) => NODE_TYPES.find((n) => n.type === type))
    .filter((n): n is NodeTypeMeta => !!n);

  return (
    <aside className="w-64 border-r border-panelBorder bg-panel shrink-0 overflow-y-auto flex flex-col">
      <div className="px-4 py-4 border-b border-panelBorder space-y-2 sticky top-0 bg-panel z-10">
        <p className="text-xs uppercase tracking-widest text-muted font-display">Nodes</p>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search nodes…"
          className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-2.5 py-1.5 text-sm"
        />
      </div>
      <div className="px-3 py-3 space-y-4 overflow-y-auto">
        {!trimmedQuery && recentNodes.length > 0 && (
          <div>
            <p className="text-[10px] uppercase text-muted px-1 mb-1.5">Recently used</p>
            <div className="grid grid-cols-3 gap-0.5">
              {recentNodes.map((n) => (
                <NodeTile
                  key={`recent-${n.type}`}
                  node={n}
                  onAdd={handleAdd}
                  dimmed={compatibleTypes ? !compatibleTypes.has(n.type) : false}
                />
              ))}
            </div>
          </div>
        )}
        {presentCategories.map((cat) => (
          <div key={cat}>
            <p className="text-[10px] uppercase tracking-wide px-1 mb-1.5 flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full inline-block"
                style={{ background: CATEGORY_META[cat].color }}
              />
              <span className="text-muted">{CATEGORY_META[cat].label}</span>
            </p>
            <div className="grid grid-cols-3 gap-0.5">
              {filteredNodes
                .filter((n) => n.category === cat)
                .slice()
                .sort((a, b) => {
                  if (!compatibleTypes) return 0;
                  return Number(compatibleTypes.has(b.type)) - Number(compatibleTypes.has(a.type));
                })
                .map((n) => (
                  <NodeTile
                    key={n.type}
                    node={n}
                    onAdd={handleAdd}
                    dimmed={compatibleTypes ? !compatibleTypes.has(n.type) : false}
                  />
                ))}
            </div>
          </div>
        ))}
        {filteredNodes.length === 0 && (
          <p className="text-muted text-xs px-2">No nodes match "{query}".</p>
        )}
      </div>
    </aside>
  );
}
