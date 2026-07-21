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
  { type: 'rssTrigger', label: 'RSS / Atom Feed', category: 'Trigger', icon: '📡', iconKey: 'lucide:Rss', color: '#F59E0B' },
  { type: 'mqttTrigger', label: 'MQTT', category: 'Trigger', icon: '📶', iconKey: 'lucide:Radio', color: '#F59E0B' },
  { type: 'formTrigger', label: 'Form', category: 'Trigger', icon: '📝', iconKey: 'lucide:FileText', color: '#F59E0B' },
  { type: 'executeWorkflowTrigger', label: 'Execute Workflow Trigger', category: 'Trigger', icon: '🎯', iconKey: 'lucide:Target', color: '#F59E0B' },

  { type: 'if', label: 'IF', category: 'Logic', icon: '⑂', iconKey: 'lucide:GitBranch', color: '#8B5CF6' },
  { type: 'filter', label: 'Filter', category: 'Logic', icon: '▽', iconKey: 'lucide:Filter', color: '#8B5CF6' },
  { type: 'switch', label: 'Switch / Router', category: 'Logic', icon: '🔀', iconKey: 'lucide:Shuffle', color: '#8B5CF6' },
  { type: 'merge', label: 'Merge', category: 'Logic', icon: '⇶', iconKey: 'lucide:Merge', color: '#8B5CF6' },
  { type: 'wait', label: 'Wait / Delay', category: 'Logic', icon: '⏳', iconKey: 'lucide:Hourglass', color: '#8B5CF6' },
  { type: 'forEach', label: 'For Each (map)', category: 'Logic', icon: '🔁', iconKey: 'lucide:Repeat', color: '#8B5CF6' },
  { type: 'forEachBranch', label: 'For Each (loop branch)', category: 'Logic', icon: '🔂', iconKey: 'lucide:RotateCw', color: '#8B5CF6' },
  { type: 'subWorkflow', label: 'Execute Workflow', category: 'Logic', icon: '📦', iconKey: 'lucide:Package', color: '#8B5CF6' },
  { type: 'waitForWebhook', label: 'Wait for Webhook', category: 'Logic', icon: '🪝', iconKey: 'lucide:Hourglass', color: '#8B5CF6' },
  { type: 'respondToWebhook', label: 'Respond to Webhook', category: 'Logic', icon: '↩', iconKey: 'lucide:Reply', color: '#8B5CF6' },
  { type: 'humanApproval', label: 'Human Approval', category: 'Logic', icon: '🧑\u200d⚖️', iconKey: 'lucide:UserCheck', color: '#8B5CF6' },
  { type: 'stopAndError', label: 'Stop and Error', category: 'Logic', icon: '⛔', iconKey: 'lucide:OctagonX', color: '#8B5CF6' },
  { type: 'noOp', label: 'No Operation', category: 'Logic', icon: '•', iconKey: 'lucide:Circle', color: '#8B5CF6' },
  { type: 'simulate', label: 'Simulate', category: 'Logic', icon: '🧪', iconKey: 'lucide:FlaskConical', color: '#8B5CF6' },
  { type: 'debugHelper', label: 'Debug Helper', category: 'Logic', icon: '🐞', iconKey: 'lucide:Bug', color: '#8B5CF6' },

  { type: 'set', label: 'Set / Transform', category: 'Data', icon: '✎', iconKey: 'lucide:PenLine', color: '#0EA5E9' },
  { type: 'splitOut', label: 'Split Out', category: 'Data', icon: '⑃', iconKey: 'lucide:SplitSquareHorizontal', color: '#0EA5E9' },
  { type: 'aggregate', label: 'Aggregate', category: 'Data', icon: '⑂', iconKey: 'lucide:Combine', color: '#0EA5E9' },
  { type: 'sort', label: 'Sort', category: 'Data', icon: '⇅', iconKey: 'lucide:ArrowUpDown', color: '#0EA5E9' },
  { type: 'limit', label: 'Limit', category: 'Data', icon: '✂', iconKey: 'lucide:Scissors', color: '#0EA5E9' },
  { type: 'removeDuplicates', label: 'Remove Duplicates', category: 'Data', icon: '⧉', iconKey: 'lucide:CopyX', color: '#0EA5E9' },
  { type: 'compareDatasets', label: 'Compare Datasets', category: 'Data', icon: '⇄', iconKey: 'lucide:GitCompare', color: '#0EA5E9' },
  { type: 'itemLists', label: 'Item Lists', category: 'Data', icon: '⋮', iconKey: 'lucide:List', color: '#0EA5E9' },
  { type: 'dateTime', label: 'Date & Time', category: 'Data', icon: '📅', iconKey: 'lucide:CalendarClock', color: '#0EA5E9' },
  { type: 'htmlExtract', label: 'HTML Extract', category: 'Data', icon: '🔖', iconKey: 'lucide:Code2', color: '#0EA5E9' },
  { type: 'markdownHtml', label: 'Markdown ⇄ HTML', category: 'Data', icon: '📝', iconKey: 'lucide:FileCode', color: '#0EA5E9' },
  { type: 'xmlJson', label: 'XML ⇄ JSON', category: 'Data', icon: '🔀', iconKey: 'lucide:FileJson', color: '#0EA5E9' },
  { type: 'crypto', label: 'Crypto', category: 'Data', icon: '🔒', iconKey: 'lucide:Lock', color: '#0EA5E9' },
  { type: 'renameKeys', label: 'Rename Keys', category: 'Data', icon: '🏷', iconKey: 'lucide:Tag', color: '#0EA5E9' },
  { type: 'moveBinaryData', label: 'Move Binary Data', category: 'Data', icon: '📦', iconKey: 'lucide:PackageOpen', color: '#0EA5E9' },
  { type: 'compression', label: 'Compression', category: 'Data', icon: '🗜', iconKey: 'lucide:Archive', color: '#0EA5E9' },
  { type: 'textParser', label: 'Text Parser', category: 'Data', icon: '🔍', iconKey: 'lucide:Regex', color: '#0EA5E9' },
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

  { type: 'trello', label: 'Trello', category: 'Integration', icon: '📋', iconKey: 'si:siTrello', color: '#0052CC' },
  { type: 'asana', label: 'Asana', category: 'Integration', icon: '✅', iconKey: 'si:siAsana', color: '#F06A6A' },
  { type: 'clickup', label: 'ClickUp', category: 'Integration', icon: '🖱', iconKey: 'si:siClickup', color: '#7B68EE' },
  { type: 'linear', label: 'Linear', category: 'Integration', icon: '📐', iconKey: 'si:siLinear', color: '#5E6AD2' },
  { type: 'jira', label: 'Jira', category: 'Integration', icon: '🎯', iconKey: 'si:siJira', color: '#0052CC' },
  { type: 'msTeams', label: 'Microsoft Teams', category: 'Integration', icon: '👥', iconKey: 'lucide:Users', color: '#6264A7' },
  { type: 'outlook', label: 'Outlook', category: 'Integration', icon: '📧', iconKey: 'lucide:Mail', color: '#0078D4' },
  { type: 'googleDrive', label: 'Google Drive', category: 'Integration', icon: '📁', iconKey: 'lucide:HardDrive', color: '#0F9D58' },
  { type: 'dropbox', label: 'Dropbox', category: 'Integration', icon: '📦', iconKey: 'si:siDropbox', color: '#0061FF' },
  { type: 'zoom', label: 'Zoom', category: 'Integration', icon: '🎥', iconKey: 'lucide:Video', color: '#2D8CFF' },
  { type: 'mongodb', label: 'MongoDB', category: 'Integration', icon: '🍃', iconKey: 'lucide:Database', color: '#47A248' },
  { type: 'mysql', label: 'MySQL', category: 'Integration', icon: '🐬', iconKey: 'lucide:Database', color: '#4479A1' },
  { type: 'sentry', label: 'Sentry', category: 'Integration', icon: '🐛', iconKey: 'lucide:Bug', color: '#362D59' },
  { type: 'pagerduty', label: 'PagerDuty', category: 'Integration', icon: '📟', iconKey: 'lucide:Siren', color: '#06AC38' },
  { type: 'datadog', label: 'Datadog', category: 'Integration', icon: '🐶', iconKey: 'lucide:Activity', color: '#632CA6' },
  { type: 'paypal', label: 'PayPal', category: 'Integration', icon: '💰', iconKey: 'si:siPaypal', color: '#00457C' },
  { type: 'quickbooks', label: 'QuickBooks', category: 'Integration', icon: '📊', iconKey: 'si:siQuickbooks', color: '#2CA01C' },
  { type: 'xero', label: 'Xero', category: 'Integration', icon: '📘', iconKey: 'si:siXero', color: '#13B5EA' },
  { type: 'zendesk', label: 'Zendesk', category: 'Integration', icon: '🎧', iconKey: 'si:siZendesk', color: '#03363D' },
  { type: 'mailchimp', label: 'Mailchimp', category: 'Integration', icon: '🐵', iconKey: 'si:siMailchimp', color: '#FFE01B' },
  { type: 'sendgrid', label: 'SendGrid', category: 'Integration', icon: '✉️', iconKey: 'si:siSendgrid', color: '#51A9E3' },
  { type: 'segment', label: 'Segment', category: 'Integration', icon: '📈', iconKey: 'si:siSegment', color: '#52BD94' },
  { type: 'googleAds', label: 'Google Ads', category: 'Integration', icon: '📣', iconKey: 'si:siGoogleads', color: '#4285F4' },
  { type: 'metaAds', label: 'Meta Ads', category: 'Integration', icon: '📢', iconKey: 'si:siMeta', color: '#0081FB' },
  { type: 'amplitude', label: 'Amplitude', category: 'Integration', icon: '📉', iconKey: 'si:siAmplitude', color: '#0A80E4' },
  { type: 'mixpanel', label: 'Mixpanel', category: 'Integration', icon: '📊', iconKey: 'si:siMixpanel', color: '#7856FF' },
  { type: 'calendly', label: 'Calendly', category: 'Integration', icon: '📅', iconKey: 'si:siCalendly', color: '#006BFF' },
  { type: 'docusign', label: 'DocuSign', category: 'Integration', icon: '✍️', iconKey: 'si:siDocusign', color: '#FFCC22' },
  { type: 'elasticsearch', label: 'Elasticsearch', category: 'Integration', icon: '🔍', iconKey: 'si:siElasticsearch', color: '#005571' },
  { type: 'sftp', label: 'SFTP / FTP', category: 'Integration', icon: '📁', iconKey: 'lucide:FolderSync', color: '#6B7280' },
  { type: 'linkedin', label: 'LinkedIn', category: 'Integration', icon: '💼', iconKey: 'si:siLinkedin', color: '#0A66C2' },
  { type: 'twitter', label: 'X (Twitter)', category: 'Integration', icon: '🐦', iconKey: 'si:siX', color: '#000000' },
  { type: 'facebook', label: 'Facebook', category: 'Integration', icon: '👍', iconKey: 'si:siFacebook', color: '#0866FF' },
  { type: 'instagram', label: 'Instagram', category: 'Integration', icon: '📷', iconKey: 'si:siInstagram', color: '#E4405F' },
  { type: 'youtube', label: 'YouTube', category: 'Integration', icon: '▶️', iconKey: 'si:siYoutube', color: '#FF0000' },

  { type: 'openai', label: 'OpenAI', category: 'AI', icon: '✨', iconKey: 'si:siOpenai', color: '#10A37F' },
  { type: 'anthropic', label: 'Anthropic (Claude)', category: 'AI', icon: '✨', iconKey: 'si:siAnthropic', color: '#D97757' },
  { type: 'gemini', label: 'Google Gemini', category: 'AI', icon: '✨', iconKey: 'si:siGooglegemini', color: '#4285F4' },
  { type: 'localLlm', label: 'Local LLM (Ollama / vLLM)', category: 'AI', icon: '🖳', iconKey: 'lucide:Server', color: '#6B7280' },
  { type: 'groq', label: 'Groq', category: 'AI', icon: '⚡', iconKey: 'lucide:Zap', color: '#F55036' },
  { type: 'mistral', label: 'Mistral', category: 'AI', icon: '✨', iconKey: 'si:siMistralai', color: '#FA520F' },
  { type: 'textClassifier', label: 'Text Classifier', category: 'AI', icon: '🏷', iconKey: 'lucide:Tags', color: '#10A37F' },
  { type: 'sentimentAnalysis', label: 'Sentiment Analysis', category: 'AI', icon: '😊', iconKey: 'lucide:Smile', color: '#10A37F' },
  { type: 'entityExtractor', label: 'Entity Extractor', category: 'AI', icon: '🧩', iconKey: 'lucide:Puzzle', color: '#10A37F' },
  { type: 'summarizer', label: 'Summarization Chain', category: 'AI', icon: '📝', iconKey: 'lucide:FileText', color: '#10A37F' },
  { type: 'qaChain', label: 'Q&A Chain', category: 'AI', icon: '❓', iconKey: 'lucide:MessageCircleQuestion', color: '#10A37F' },
  { type: 'structuredOutputParser', label: 'Structured Output Parser', category: 'AI', icon: '📐', iconKey: 'lucide:Ruler', color: '#10A37F' },
  { type: 'autoFixingOutputParser', label: 'Auto-fixing Output Parser', category: 'AI', icon: '🩹', iconKey: 'lucide:Wrench', color: '#10A37F' },
  { type: 'ragIngest', label: 'RAG: Ingest', category: 'AI', icon: '📥', iconKey: 'lucide:FileInput', color: '#10A37F' },
  { type: 'ragQuery', label: 'RAG: Query', category: 'AI', icon: '🔎', iconKey: 'lucide:Search', color: '#10A37F' },
  { type: 'embeddingProvider', label: 'Embedding', category: 'AI', icon: '🔢', iconKey: 'lucide:Binary', color: '#10A37F' },
  { type: 'textSplitterConfig', label: 'Text Splitter', category: 'AI', icon: '✂️', iconKey: 'lucide:Scissors', color: '#10A37F' },
  { type: 'vectorStoreConfig', label: 'Vector Store', category: 'AI', icon: '🗂', iconKey: 'lucide:Layers', color: '#10A37F' },
  { type: 'agentTool', label: 'Tool', category: 'AI', icon: '🛠', iconKey: 'lucide:Wrench', color: '#10A37F' },
  { type: 'agent', label: 'AI Agent', category: 'AI', icon: '🤖', iconKey: 'lucide:Bot', color: '#10A37F' },
  { type: 'agentMemory', label: 'Agent Memory', category: 'AI', icon: '🧠', iconKey: 'lucide:Brain', color: '#10A37F' },
  { type: 'redisMemory', label: 'Redis Chat Memory', category: 'AI', icon: '🗄', iconKey: 'lucide:Database', color: '#10A37F' },
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