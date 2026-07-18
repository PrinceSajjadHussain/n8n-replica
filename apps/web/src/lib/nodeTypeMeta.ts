export type NodeCategory = 'Trigger' | 'Logic' | 'Data' | 'Integration' | 'AI';

export interface NodeTypeMeta {
  type: string;
  label: string;
  category: NodeCategory;
  icon: string;
  /** Brand-ish accent color for the icon swatch, kept consistent with CREDENTIAL_TYPE_META colors for shared types. */
  color: string;
}

/**
 * Single source of truth for every addable node type: what it's called, which
 * category it lives in, its icon, and its accent color. The palette, the
 * canvas node chrome (FlowNode), and eventually the credential picker's node
 * hints all read from here so an icon/color only has to be defined once.
 */
export const NODE_TYPES: NodeTypeMeta[] = [
  { type: 'webhook', label: 'Webhook', category: 'Trigger', icon: '⚡', color: '#F59E0B' },
  { type: 'schedule', label: 'Schedule', category: 'Trigger', icon: '⏱', color: '#F59E0B' },

  { type: 'if', label: 'IF', category: 'Logic', icon: '⑂', color: '#8B5CF6' },
  { type: 'switch', label: 'Switch / Router', category: 'Logic', icon: '🔀', color: '#8B5CF6' },
  { type: 'merge', label: 'Merge', category: 'Logic', icon: '⇶', color: '#8B5CF6' },
  { type: 'wait', label: 'Wait / Delay', category: 'Logic', icon: '⏳', color: '#8B5CF6' },
  { type: 'forEach', label: 'For Each (map)', category: 'Logic', icon: '🔁', color: '#8B5CF6' },
  { type: 'forEachBranch', label: 'For Each (loop branch)', category: 'Logic', icon: '🔂', color: '#8B5CF6' },
  { type: 'subWorkflow', label: 'Execute Workflow', category: 'Logic', icon: '📦', color: '#8B5CF6' },
  { type: 'waitForWebhook', label: 'Wait for Webhook', category: 'Logic', icon: '🪝', color: '#8B5CF6' },
  { type: 'respondToWebhook', label: 'Respond to Webhook', category: 'Logic', icon: '↩', color: '#8B5CF6' },
  { type: 'humanApproval', label: 'Human Approval', category: 'Logic', icon: '🧑\u200d⚖️', color: '#8B5CF6' },

  { type: 'set', label: 'Set / Transform', category: 'Data', icon: '✎', color: '#0EA5E9' },
  { type: 'code', label: 'Code (JS)', category: 'Data', icon: '⌨', color: '#0EA5E9' },
  { type: 'dataTableRead', label: 'Data Table: Get/List', category: 'Data', icon: '▦', color: '#0EA5E9' },
  { type: 'dataTableWrite', label: 'Data Table: Insert/Update/Delete', category: 'Data', icon: '▤', color: '#0EA5E9' },
  { type: 'fileExtract', label: 'Extract from File', category: 'Data', icon: '📤', color: '#0EA5E9' },
  { type: 'fileConvert', label: 'Convert to File', category: 'Data', icon: '📥', color: '#0EA5E9' },

  { type: 'slack', label: 'Slack', category: 'Integration', icon: '#', color: '#4A154B' },
  { type: 'discord', label: 'Discord', category: 'Integration', icon: '🎮', color: '#5865F2' },
  { type: 'telegram', label: 'Telegram', category: 'Integration', icon: '✈', color: '#26A5E4' },
  { type: 'notion', label: 'Notion', category: 'Integration', icon: '📓', color: '#000000' },
  { type: 'github', label: 'GitHub', category: 'Integration', icon: '🐙', color: '#24292F' },
  { type: 'postgres', label: 'Postgres', category: 'Integration', icon: '🐘', color: '#336791' },
  { type: 'email', label: 'Email', category: 'Integration', icon: '✉', color: '#EA4335' },
  { type: 'googleSheets', label: 'Google Sheets', category: 'Integration', icon: '▦', color: '#0F9D58' },
  { type: 'httpRequest', label: 'HTTP Request', category: 'Integration', icon: '🌐', color: '#6B7280' },

  { type: 'openai', label: 'OpenAI', category: 'AI', icon: '✨', color: '#10A37F' },
  { type: 'ragIngest', label: 'RAG: Ingest', category: 'AI', icon: '📥', color: '#10A37F' },
  { type: 'ragQuery', label: 'RAG: Query', category: 'AI', icon: '🔎', color: '#10A37F' },
  { type: 'agent', label: 'AI Agent', category: 'AI', icon: '🤖', color: '#10A37F' },
  { type: 'agentMemory', label: 'Agent Memory', category: 'AI', icon: '🧠', color: '#10A37F' },
  { type: 'agentOrchestrator', label: 'Multi-Agent Orchestrator', category: 'AI', icon: '🕸', color: '#10A37F' },
  { type: 'browserAutomation', label: 'Browser Automation', category: 'AI', icon: '🖥', color: '#10A37F' },
];

const BY_TYPE: Record<string, NodeTypeMeta> = Object.fromEntries(NODE_TYPES.map((n) => [n.type, n]));

export function getNodeTypeMeta(type: string): NodeTypeMeta {
  return (
    BY_TYPE[type] ?? {
      type,
      label: type,
      category: 'Data',
      icon: '◆',
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
