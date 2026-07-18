const AVAILABLE_NODES = [
  { type: 'webhook', label: 'Webhook', category: 'Trigger' },
  { type: 'schedule', label: 'Schedule', category: 'Trigger' },
  { type: 'httpRequest', label: 'HTTP Request', category: 'Action' },
  { type: 'if', label: 'IF', category: 'Logic' },
  { type: 'switch', label: 'Switch / Router', category: 'Logic' },
  { type: 'merge', label: 'Merge', category: 'Logic' },
  { type: 'wait', label: 'Wait / Delay', category: 'Logic' },
  { type: 'forEach', label: 'For Each (map)', category: 'Logic' },
  { type: 'forEachBranch', label: 'For Each (loop branch)', category: 'Logic' },
  { type: 'subWorkflow', label: 'Execute Workflow', category: 'Logic' },
  { type: 'waitForWebhook', label: 'Wait for Webhook', category: 'Logic' },
  { type: 'humanApproval', label: 'Human Approval', category: 'Logic' },
  { type: 'set', label: 'Set / Transform', category: 'Data' },
  { type: 'code', label: 'Code (JS)', category: 'Data' },
  { type: 'slack', label: 'Slack', category: 'Integration' },
  { type: 'discord', label: 'Discord', category: 'Integration' },
  { type: 'telegram', label: 'Telegram', category: 'Integration' },
  { type: 'notion', label: 'Notion', category: 'Integration' },
  { type: 'github', label: 'GitHub', category: 'Integration' },
  { type: 'postgres', label: 'Postgres', category: 'Integration' },
  { type: 'email', label: 'Email (stub)', category: 'Integration' },
  { type: 'googleSheets', label: 'Google Sheets (stub)', category: 'Integration' },
  { type: 'openai', label: 'OpenAI', category: 'AI' },
  { type: 'ragIngest', label: 'RAG: Ingest (PDF/DOCX/CSV/Web/Drive/Notion)', category: 'AI' },
  { type: 'ragQuery', label: 'RAG: Query (hybrid + rerank)', category: 'AI' },
  { type: 'agent', label: 'AI Agent', category: 'AI' },
  { type: 'agentMemory', label: 'Agent Memory', category: 'AI' },
  { type: 'agentOrchestrator', label: 'Multi-Agent Orchestrator', category: 'AI' },
  { type: 'browserAutomation', label: 'Browser Automation', category: 'AI' },
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
