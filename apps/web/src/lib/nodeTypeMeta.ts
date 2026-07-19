export type NodeCategory = 'Trigger' | 'Logic' | 'Data' | 'Integration' | 'AI';

export interface NodeTypeMeta {
  type: string;
  label: string;
  category: NodeCategory;
  /**
   * Emoji fallback — kept so a node type with no `iconKey` (or a brand new
   * community node type nobody has mapped yet) still renders *something*
   * instead of crashing. `<NodeIcon>` only falls back to this when `iconKey`
   * is absent or doesn't resolve.
   */
  icon: string;
  /**
   * Lookup key for the real vector icon, consumed by `<NodeIcon>`:
   *  - `si:<simpleIconsExportName>` — a branded service mark from the
   *    `simple-icons` package (e.g. `si:siSlack`).
   *  - `lucide:<ComponentName>` — a generic/logic glyph from `lucide-react`
   *    (e.g. `lucide:GitBranch`).
   * Leave undefined to always use the emoji fallback.
   */
  iconKey?: string;
  /**
   * Brand-ish accent color for the icon swatch. For nodes with a real
   * `si:` iconKey this is overridden at render time by that brand's own hex
   * (see NodeIcon.tsx) so this value only matters as a pre-icon-load/loading
   * color and for logic/generic nodes that have no brand color.
   */
  color: string;
}

/**
 * Single source of truth for every addable node type: what it's called, which
 * category it lives in, its icon, and its accent color. The palette, the
 * canvas node chrome (FlowNode), the Marketplace, and the template gallery's
 * graph-preview thumbnails all read from here so an icon/color only has to be
 * defined once.
 */
export const NODE_TYPES: NodeTypeMeta[] = [
  { type: 'webhook', label: 'Webhook', category: 'Trigger', icon: '⚡', iconKey: 'lucide:Webhook', color: '#F59E0B' },
  { type: 'schedule', label: 'Schedule', category: 'Trigger', icon: '⏱', iconKey: 'lucide:Clock', color: '#F59E0B' },
  { type: 'chatTrigger', label: 'Chat Message', category: 'Trigger', icon: '💬', iconKey: 'lucide:MessageCircle', color: '#F59E0B' },

  { type: 'if', label: 'IF', category: 'Logic', icon: '⑂', iconKey: 'lucide:GitBranch', color: '#8B5CF6' },
  { type: 'switch', label: 'Switch / Router', category: 'Logic', icon: '🔀', iconKey: 'lucide:Shuffle', color: '#8B5CF6' },
  { type: 'merge', label: 'Merge', category: 'Logic', icon: '⇶', iconKey: 'lucide:Merge', color: '#8B5CF6' },
  { type: 'wait', label: 'Wait / Delay', category: 'Logic', icon: '⏳', iconKey: 'lucide:Hourglass', color: '#8B5CF6' },
  { type: 'forEach', label: 'For Each (map)', category: 'Logic', icon: '🔁', iconKey: 'lucide:Repeat', color: '#8B5CF6' },
  { type: 'forEachBranch', label: 'For Each (loop branch)', category: 'Logic', icon: '🔂', iconKey: 'lucide:RotateCw', color: '#8B5CF6' },
  { type: 'subWorkflow', label: 'Execute Workflow', category: 'Logic', icon: '📦', iconKey: 'lucide:Package', color: '#8B5CF6' },
  { type: 'waitForWebhook', label: 'Wait for Webhook', category: 'Logic', icon: '🪝', iconKey: 'lucide:Hourglass', color: '#8B5CF6' },
  { type: 'respondToWebhook', label: 'Respond to Webhook', category: 'Logic', icon: '↩', iconKey: 'lucide:Reply', color: '#8B5CF6' },
  { type: 'humanApproval', label: 'Human Approval', category: 'Logic', icon: '🧑\u200d⚖️', iconKey: 'lucide:UserCheck', color: '#8B5CF6' },

  { type: 'set', label: 'Set / Transform', category: 'Data', icon: '✎', iconKey: 'lucide:PenLine', color: '#0EA5E9' },
  { type: 'code', label: 'Code (JS)', category: 'Data', icon: '⌨', iconKey: 'lucide:Braces', color: '#0EA5E9' },
  { type: 'dataTableRead', label: 'Data Table: Get/List', category: 'Data', icon: '▦', iconKey: 'lucide:Table', color: '#0EA5E9' },
  { type: 'dataTableWrite', label: 'Data Table: Insert/Update/Delete', category: 'Data', icon: '▤', iconKey: 'lucide:TableProperties', color: '#0EA5E9' },
  { type: 'fileExtract', label: 'Extract from File', category: 'Data', icon: '📤', iconKey: 'lucide:FileOutput', color: '#0EA5E9' },
  { type: 'fileConvert', label: 'Convert to File', category: 'Data', icon: '📥', iconKey: 'lucide:FileInput', color: '#0EA5E9' },

  { type: 'slack', label: 'Slack', category: 'Integration', icon: '#', iconKey: 'si:siSlack', color: '#4A154B' },
  { type: 'discord', label: 'Discord', category: 'Integration', icon: '🎮', iconKey: 'si:siDiscord', color: '#5865F2' },
  { type: 'telegram', label: 'Telegram', category: 'Integration', icon: '✈', iconKey: 'si:siTelegram', color: '#26A5E4' },
  { type: 'notion', label: 'Notion', category: 'Integration', icon: '📓', iconKey: 'si:siNotion', color: '#000000' },
  { type: 'github', label: 'GitHub', category: 'Integration', icon: '🐙', iconKey: 'si:siGithub', color: '#181717' },
  { type: 'postgres', label: 'Postgres', category: 'Integration', icon: '🐘', iconKey: 'si:siPostgresql', color: '#336791' },
  { type: 'email', label: 'Email', category: 'Integration', icon: '✉', iconKey: 'lucide:Mail', color: '#EA4335' },
  { type: 'googleSheets', label: 'Google Sheets', category: 'Integration', icon: '▦', iconKey: 'si:siGooglesheets', color: '#0F9D58' },
  { type: 'httpRequest', label: 'HTTP Request', category: 'Integration', icon: '🌐', iconKey: 'lucide:Globe', color: '#6B7280' },

  { type: 'openai', label: 'OpenAI', category: 'AI', icon: '✨', iconKey: 'si:siOpenai', color: '#10A37F' },
  { type: 'anthropic', label: 'Anthropic (Claude)', category: 'AI', icon: '✨', iconKey: 'si:siAnthropic', color: '#D97757' },
  { type: 'gemini', label: 'Google Gemini', category: 'AI', icon: '✨', iconKey: 'si:siGooglegemini', color: '#4285F4' },
  { type: 'ragIngest', label: 'RAG: Ingest', category: 'AI', icon: '📥', iconKey: 'lucide:FileInput', color: '#10A37F' },
  { type: 'ragQuery', label: 'RAG: Query', category: 'AI', icon: '🔎', iconKey: 'lucide:Search', color: '#10A37F' },
  { type: 'agent', label: 'AI Agent', category: 'AI', icon: '🤖', iconKey: 'lucide:Bot', color: '#10A37F' },
  { type: 'agentMemory', label: 'Agent Memory', category: 'AI', icon: '🧠', iconKey: 'lucide:Brain', color: '#10A37F' },
  { type: 'agentOrchestrator', label: 'Multi-Agent Orchestrator', category: 'AI', icon: '🕸', iconKey: 'lucide:Share2', color: '#10A37F' },
  { type: 'browserAutomation', label: 'Browser Automation', category: 'AI', icon: '🖥', iconKey: 'lucide:MonitorSmartphone', color: '#10A37F' },
];

const BY_TYPE: Record<string, NodeTypeMeta> = Object.fromEntries(NODE_TYPES.map((n) => [n.type, n]));

export function getNodeTypeMeta(type: string): NodeTypeMeta {
  return (
    BY_TYPE[type] ?? {
      type,
      label: type,
      category: 'Data',
      icon: '◆',
      iconKey: 'lucide:Puzzle',
      color: '#6B7280',
    }
  );
}

export const NODE_CATEGORIES: NodeCategory[] = ['Trigger', 'Logic', 'Data', 'Integration', 'AI'];

export const CATEGORY_META: Record<NodeCategory, { label: string; color: string }> = {
  Trigger: { label: 'Triggers', color: '#F59E0B' },
  Logic: { label: 'Logic & flow', color: '#8B5CF6' },
  Data: { label: 'Data', color: '#0EA5E9' },
  Integration: { label: 'Integrations', color: '#22C55E' },
  AI: { label: 'AI & Agents', color: '#10A37F' },
};
