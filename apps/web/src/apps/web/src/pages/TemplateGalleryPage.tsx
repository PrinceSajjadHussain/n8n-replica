import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
}

export default function TemplateGalleryPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/templates').then(({ data }) => setTemplates(data.templates));
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

  const categories = Array.from(new Set(templates.map((t) => t.category)));

  return (
    <div className="min-h-screen bg-canvas text-ink p-8">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/workflows" className="text-sm text-muted hover:text-ink">
          ← Workflows
        </Link>
        <h1 className="text-xl font-semibold">Template gallery</h1>
      </div>

      {categories.map((category) => (
        <div key={category} className="mb-8">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">{category}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates
              .filter((t) => t.category === category)
              .map((t) => (
                <div key={t.id} className="border border-panelBorder rounded-lg p-4 bg-panel flex flex-col justify-between">
                  <div>
                    <h3 className="font-medium mb-1">{t.name}</h3>
                    <p className="text-sm text-muted">{t.description}</p>
                  </div>
                  <button
                    onClick={() => useTemplate(t.id)}
                    disabled={busyId === t.id}
                    className="focus-ring mt-4 self-start text-sm px-3 py-1.5 rounded-md bg-signal text-canvas font-medium hover:brightness-110 transition disabled:opacity-50"
                  >
                    {busyId === t.id ? 'Creating…' : 'Use this template'}
                  </button>
                </div>
              ))}
          </div>
        </div>
      ))}

      {templates.length === 0 && <p className="text-sm text-muted">Loading templates…</p>}
    </div>
  );
}
