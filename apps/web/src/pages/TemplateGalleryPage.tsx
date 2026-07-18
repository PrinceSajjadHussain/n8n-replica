import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { getNodeTypeMeta } from '../lib/nodeTypeMeta';

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  usageCount: number;
  appTypes: string[];
}

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
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm leading-none shadow-sm ring-2 ring-panel"
            style={{ background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}55` }}
          >
            {meta.icon}
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

export default function TemplateGalleryPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
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
      if (activeCategory && t.category !== activeCategory) return false;
      if (!trimmedQuery) return true;
      const appLabels = t.appTypes.map((type) => getNodeTypeMeta(type).label.toLowerCase());
      return (
        t.name.toLowerCase().includes(trimmedQuery) ||
        t.description.toLowerCase().includes(trimmedQuery) ||
        t.category.toLowerCase().includes(trimmedQuery) ||
        appLabels.some((label) => label.includes(trimmedQuery))
      );
    });
  }, [templates, activeCategory, trimmedQuery]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => b.usageCount - a.usageCount), [filtered]);

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
          <p className="text-sm text-muted mt-0.5">Start from a ready-made workflow instead of a blank canvas.</p>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search templates or apps…"
          className="focus-ring w-full sm:w-72 bg-panel border border-panelBorder rounded-md px-3 py-2 text-sm"
        />
      </div>

      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setActiveCategory(null)}
          className={`focus-ring text-xs px-3 py-1.5 rounded-full border transition ${
            activeCategory === null
              ? 'bg-signal text-canvas border-signal font-medium'
              : 'border-panelBorder text-muted hover:text-ink hover:border-ink/30'
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`focus-ring text-xs px-3 py-1.5 rounded-full border transition ${
              activeCategory === cat
                ? 'bg-signal text-canvas border-signal font-medium'
                : 'border-panelBorder text-muted hover:text-ink hover:border-ink/30'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

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
            className="border border-panelBorder rounded-lg p-4 bg-panel flex flex-col justify-between hover:border-ink/20 transition"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <AppIconRow appTypes={t.appTypes} />
                <span className="text-[10px] uppercase tracking-wide text-muted bg-canvas border border-panelBorder rounded-full px-2 py-0.5">
                  {t.category}
                </span>
              </div>
              <h3 className="font-medium mb-1">{t.name}</h3>
              <p className="text-sm text-muted">{t.description}</p>
            </div>
            <div className="flex items-center justify-between mt-4">
              <span className="text-[11px] text-muted">{formatUsageCount(t.usageCount)} uses</span>
              <button
                onClick={() => useTemplate(t.id)}
                disabled={busyId === t.id}
                className="focus-ring text-sm px-3 py-1.5 rounded-md bg-signal text-canvas font-medium hover:brightness-110 transition disabled:opacity-50"
              >
                {busyId === t.id ? 'Creating…' : 'Use this template'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
