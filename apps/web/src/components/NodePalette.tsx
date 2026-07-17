const AVAILABLE_NODES = [
  { type: 'webhook', label: 'Webhook', category: 'Trigger' },
  { type: 'schedule', label: 'Schedule', category: 'Trigger' },
  { type: 'httpRequest', label: 'HTTP Request', category: 'Action' },
  { type: 'if', label: 'IF', category: 'Logic' },
  { type: 'merge', label: 'Merge', category: 'Logic' },
  { type: 'set', label: 'Set / Transform', category: 'Data' },
  { type: 'code', label: 'Code (JS)', category: 'Data' },
  { type: 'slack', label: 'Slack', category: 'Integration' },
  { type: 'email', label: 'Email (stub)', category: 'Integration' },
  { type: 'googleSheets', label: 'Google Sheets (stub)', category: 'Integration' },
] as const;

export default function NodePalette({ onAdd }: { onAdd: (type: string, label: string) => void }) {
  const categories = Array.from(new Set(AVAILABLE_NODES.map((n) => n.category)));

  return (
    <aside className="w-56 border-r border-panelBorder bg-panel shrink-0 overflow-y-auto">
      <div className="px-4 py-4 border-b border-panelBorder">
        <p className="text-xs uppercase tracking-widest text-muted font-display">Nodes</p>
      </div>
      <div className="px-3 py-3 space-y-4">
        {categories.map((cat) => (
          <div key={cat}>
            <p className="text-[10px] uppercase text-muted px-2 mb-1">{cat}</p>
            <div className="space-y-1">
              {AVAILABLE_NODES.filter((n) => n.category === cat).map((n) => (
                <button
                  key={n.type}
                  onClick={() => onAdd(n.type, n.label)}
                  className="focus-ring w-full text-left px-2.5 py-2 rounded-md text-sm text-ink hover:bg-canvas hover:text-signal transition"
                >
                  {n.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
