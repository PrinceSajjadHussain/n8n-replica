import { useEffect, useState } from 'react';

interface Props {
  nodeId: string;
  nodeType: string;
  label: string;
  params: Record<string, unknown>;
  credentialId: string | null;
  credentials: { id: string; type: string }[];
  onChange: (updates: { label?: string; params?: Record<string, unknown>; credentialId?: string | null }) => void;
  onDelete: () => void;
  onClose: () => void;
}

export default function NodeConfigPanel({
  nodeId,
  nodeType,
  label,
  params,
  credentialId,
  credentials,
  onChange,
  onDelete,
  onClose,
}: Props) {
  const [localLabel, setLocalLabel] = useState(label);
  const [paramsJson, setParamsJson] = useState(JSON.stringify(params, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    setLocalLabel(label);
    setParamsJson(JSON.stringify(params, null, 2));
    setJsonError(null);
  }, [nodeId]);

  function commitParams() {
    try {
      const parsed = JSON.parse(paramsJson);
      setJsonError(null);
      onChange({ params: parsed });
    } catch {
      setJsonError('Invalid JSON — changes not saved yet.');
    }
  }

  return (
    <aside className="w-80 border-l border-panelBorder bg-panel shrink-0 overflow-y-auto flex flex-col">
      <div className="px-4 py-4 border-b border-panelBorder flex items-center justify-between">
        <p className="text-xs uppercase tracking-widest text-muted font-display">Configure node</p>
        <button onClick={onClose} className="focus-ring text-muted hover:text-ink text-sm">
          ✕
        </button>
      </div>

      <div className="p-4 space-y-4 flex-1">
        <div>
          <label className="block text-xs text-muted mb-1">Label</label>
          <input
            value={localLabel}
            onChange={(e) => setLocalLabel(e.target.value)}
            onBlur={() => onChange({ label: localLabel })}
            className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-muted mb-1">Type</label>
          <p className="text-sm text-muted font-display">{nodeType}</p>
        </div>

        {['httpRequest', 'slack', 'email', 'googleSheets'].includes(nodeType) && (
          <div>
            <label className="block text-xs text-muted mb-1">Credential</label>
            <select
              value={credentialId ?? ''}
              onChange={(e) => onChange({ credentialId: e.target.value || null })}
              className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm"
            >
              <option value="">None</option>
              {credentials.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.type} ({c.id.slice(0, 8)})
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs text-muted mb-1">Params (JSON)</label>
          <textarea
            value={paramsJson}
            onChange={(e) => setParamsJson(e.target.value)}
            onBlur={commitParams}
            rows={10}
            className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-xs font-display"
          />
          {jsonError && <p className="text-alert text-xs mt-1">{jsonError}</p>}
          <p className="text-muted text-[11px] mt-1">
            {paramHint(nodeType)}
          </p>
        </div>
      </div>

      <div className="p-4 border-t border-panelBorder">
        <button
          onClick={onDelete}
          className="focus-ring w-full text-sm text-alert hover:bg-alert/10 rounded-md py-2 transition"
        >
          Delete node
        </button>
      </div>
    </aside>
  );
}

function paramHint(nodeType: string): string {
  switch (nodeType) {
    case 'webhook':
      return 'e.g. { "path": "orders" } — this becomes /webhook/:workflowId/orders';
    case 'schedule':
      return 'e.g. { "cron": "*/5 * * * *" }';
    case 'httpRequest':
      return 'e.g. { "url": "https://api.example.com", "method": "GET" }';
    case 'if':
      return 'e.g. { "field": "amount", "operator": "greaterThan", "value": 100 }';
    case 'set':
      return 'e.g. { "mappings": [{ "targetPath": "summary", "staticValue": "done" }] }';
    case 'code':
      return 'e.g. { "code": "return { doubled: input.value * 2 };" }';
    case 'slack':
      return 'e.g. { "text": "New order received!" } — requires a Slack credential';
    default:
      return 'Configure this node\u2019s parameters as JSON.';
  }
}
