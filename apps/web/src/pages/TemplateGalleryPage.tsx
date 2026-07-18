import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { getNodeTypeMeta } from '../lib/nodeTypeMeta';
import NodeIcon from '../components/NodeIcon';
import FilterPillGroup from '../components/ui/FilterPillGroup';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';

type Difficulty = 'beginner' | 'intermediate' | 'advanced';
type SortMode = 'usage' | 'newest' | 'difficulty';

interface TemplateGraphNode {
  id: string;
  type: string;
  position: { x: number; y: number };
}
interface TemplateGraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string | null;
}

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  usageCount: number;
  appTypes: string[];
  difficulty: Difficulty;
  estimatedSetupMinutes: number;
  requiredCredentialTypes: string[];
  order: number;
  nodes: TemplateGraphNode[];
  edges: TemplateGraphEdge[];
}

const DIFFICULTY_META: Record<Difficulty, { label: string; color: string; rank: number }> = {
  beginner: { label: 'Beginner', color: '#22C55E', rank: 0 },
  intermediate: { label: 'Intermediate', color: '#F59E0B', rank: 1 },
  advanced: { label: 'Advanced', color: '#EF4444', rank: 2 },
};

function formatUsageCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0)}k`;
  return String(n);
}

/** Small stack of colored app icons (Make-style "app-icon pair"), one per
 *  distinct node type used in the template, in graph order. */
function AppIconRow({ appTypes }: { appTypes: string[] }) {
  const shown = appTypes.slice(0, 4);
  const overflow = appTypes.length - shown.length;
  return (
    <div className="flex items-center -space-x-2">
      {shown.map((type, i) => {
        const meta = getNodeTypeMeta(type);
        return (
          <span
            key={`${type}-${i}`}
            title={meta.label}
            className="w-8 h-8 rounded-full flex items-center justify-center leading-none shadow-sm ring-2 ring-panel"
            style={{ background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}55` }}
          >
            <NodeIcon type={type} size={16} />
          </span>
        );
      })}
      {overflow > 0 && (
        <span className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-medium shadow-sm ring-2 ring-panel bg-canvas text-muted border border-panelBorder">
          +{overflow}
        </span>
      )}
    </div>
  );
}

/**
 * Lightweight inline SVG "mini-map" of a template's node graph — boxes
 * (real node color + icon, via `<NodeIcon>`/`nodeTypeMeta`) with arrows
 * following the template's actual node positions/edges. This is the
 * low-effort equivalent of Make.com's template screenshots: it's rendered
 * client-side from data the gallery already fetched, no separate asset
 * pipeline or screenshot infra required.
 */
function TemplateGraphPreview({ nodes, edges }: { nodes: TemplateGraphNode[]; edges: TemplateGraphEdge[] }) {
  if (nodes.length === 0) return null;
  const BOX = 34;
  const PAD = 20;
  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const width = maxX - minX + BOX + PAD * 2;
  const height = maxY - minY + BOX + PAD * 2;
  const pos = (n: TemplateGraphNode) => ({
    x: n.position.x - minX + PAD,
    y: n.position.y - minY + PAD,
  });
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      style={{ maxHeight: 120 }}
      preserveAspectRatio="xMidYMid meet"
    >
      <g opacity={0.5}>
        {edges.map((e) => {
          const s = byId[e.source];
          const t = byId[e.target];
          if (!s || !t) return null;
          const sp = pos(s);
          const tp = pos(t);
          const x1 = sp.x + BOX;
          const y1 = sp.y + BOX / 2;
          const x2 = tp.x;
          const y2 = tp.y + BOX / 2;
          const midX = (x1 + x2) / 2;
          return (
            <path
              key={e.id}
              d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
              stroke={e.sourceHandle === 'false' ? '#EF4444' : e.sourceHandle === 'true' ? '#22C55E' : 'var(--color-muted, #6B7280)'}
              strokeWidth={1.5}
              fill="none"
            />
          );
        })}
      </g>
      {nodes.map((n) => {
        const meta = getNodeTypeMeta(n.type);
        const p = pos(n);
        return (
          <g key={n.id} transform={`translate(${p.x}, ${p.y})`}>
            <rect
              width={BOX}
              height={BOX}
              rx={8}
              fill={`${meta.color}22`}
              stroke={`${meta.color}66`}
              strokeWidth={1}
            />
            <foreignObject width={BOX} height={BOX}>
              <div style={{ width: BOX, height: BOX, display: 'flex', alignItems: 'center', justifyContent: 'center', color: meta.color }}>
                <NodeIcon type={n.type} size={16} />
              </div>
            </foreignObject>
          </g>
        );
      })}
    </svg>
  );
}

function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  const meta = DIFFICULTY_META[difficulty];
  return (
    <span
      className="text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 font-medium"
      style={{ background: `${meta.color}1A`, color: meta.color, border: `1px solid ${meta.color}40` }}
    >
      {meta.label}
    </span>
  );
}

export default function TemplateGalleryPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeCategories, setActiveCategories] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>('usage');
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get('/templates')
      .then(({ data }) => setTemplates(data.templates))
      .finally(() => setLoading(false));
  }, []);

  async function useTemplate(id: string) {
    setBusyId(id);
    try {
      const { data } = await api.post(`/templates/${id}/use`, {});
      navigate(`/workflows/${data.workflow.id}`);
    } finally {
      setBusyId(null);
    }
  }

  const categories = useMemo(() => Array.from(new Set(templates.map((t) => t.category))).sort(), [templates]);




  const trimmedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    return templates.filter((t) => {
      if (activeCategories.length > 0 && !activeCategories.includes(t.category)) return false;
      if (!trimmedQuery) return true;
      const appLabels = t.appTypes.map((type) => getNodeTypeMeta(type).label.toLowerCase());
      return (
        t.name.toLowerCase().includes(trimmedQuery) ||
        t.description.toLowerCase().includes(trimmedQuery) ||
        t.category.toLowerCase().includes(trimmedQuery) ||
        t.appTypes.some((type) => type.toLowerCase().includes(trimmedQuery)) ||
        appLabels.some((label) => label.includes(trimmedQuery))
      );
    });
  }, [templates, activeCategories, trimmedQuery]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    switch (sortMode) {
      case 'newest':
        return copy.sort((a, b) => b.order - a.order);
      case 'difficulty':
        return copy.sort((a, b) => DIFFICULTY_META[a.difficulty].rank - DIFFICULTY_META[b.difficulty].rank);
      case 'usage':
      default:
        return copy.sort((a, b) => b.usageCount - a.usageCount);
    }
  }, [filtered, sortMode]);

  return (
    <div className="min-h-screen bg-canvas text-ink p-8">
      <div className="flex items-center gap-3 mb-1">
        <Link to="/workflows" className="text-sm text-muted hover:text-ink">
          ← Workflows
        </Link>
      </div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Template gallery</h1>
          <p className="text-sm text-muted mt-0.5">
            Start from a ready-made workflow instead of a blank canvas. {templates.length} templates across{' '}
            {categories.length} categories, curated and maintained in-house — for reference, n8n's community library
            has 2000+ user-submitted templates. Closing that gap is a matter of opening template submissions, not
            gallery capacity; the schema here already supports it (see note below).
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="focus-ring bg-panel border border-panelBorder rounded-md px-2.5 py-2 text-sm"
          >
            <option value="usage">Sort: Most used</option>
            <option value="newest">Sort: Newest</option>
            <option value="difficulty">Sort: Difficulty</option>
          </select>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates or apps…"
            className="focus-ring w-full sm:w-72 bg-panel border border-panelBorder rounded-md px-3 py-2 text-sm"
          />
        </div>
      </div>

      <FilterPillGroup
        mode="multi"
        options={categories.map((cat) => ({ value: cat, label: cat }))}
        value={activeCategories}
        onChange={setActiveCategories}
        aria-label="Filter by category"
        hint={activeCategories.length > 1 ? `${activeCategories.length} categories selected` : undefined}
        className="mb-6"
      />

      {loading && <p className="text-sm text-muted">Loading templates…</p>}

      {!loading && sorted.length === 0 && (
        <div className="border border-dashed border-panelBorder rounded-lg p-10 text-center">
          <p className="text-sm text-muted">No templates match "{query}".</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sorted.map((t) => (
          <div
            key={t.id}
            className="border border-panelBorder rounded-lg p-4 bg-panel flex flex-col justify-between hover:border-ink/20 hover:shadow-lg transition"
          >
            <div>
              <div className="rounded-md bg-canvas border border-panelBorder mb-3 px-2 py-1 flex items-center justify-center">
                <TemplateGraphPreview nodes={t.nodes} edges={t.edges} />
              </div>
              <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                <AppIconRow appTypes={t.appTypes} />
                <Badge variant="neutral">{t.category}</Badge>
              </div>
              <h3 className="font-medium mb-1">{t.name}</h3>
              <p className="text-sm text-muted">{t.description}</p>
              <div className="flex items-center gap-1.5 flex-wrap mt-3">
                <DifficultyBadge difficulty={t.difficulty} />
                <Badge variant="neutral">~{t.estimatedSetupMinutes} min setup</Badge>
              </div>
              {t.requiredCredentialTypes.length > 0 && (
                <p className="text-[11px] text-muted mt-2">
                  Needs: {t.requiredCredentialTypes.join(', ')}
                </p>
              )}
            </div>
            <div className="flex items-center justify-between mt-4">
              <span className="text-[11px] text-muted">{formatUsageCount(t.usageCount)} uses</span>
              <Button onClick={() => useTemplate(t.id)} loading={busyId === t.id}>
                {busyId === t.id ? 'Creating…' : 'Use this template'}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
