/**
 * Default `params` a brand-new node is created with, keyed by node type.
 *
 * Before this file existed every node was dropped onto the canvas with
 * `params: {}`, which was fine for the ~45 node types that have a guided
 * form (see paramSchemas.ts) but left roughly 60 integration/AI/logic node
 * types with a bare, empty raw-JSON textarea and no clue what shape the
 * worker expects — the exact "payload should already be defined, I should
 * only need to tweak a couple of fields" gap reported by users.
 *
 * These defaults mirror the actual `params.xxx` fields each node's execute()
 * function in apps/worker/src/nodes reads (action names, required IDs, etc.),
 * using obviously-placeholder values (e.g. "REPLACE_ME") for anything that
 * has no sane default (an ID, a URL) so the JSON is always valid and the
 * remaining work is genuinely just swapping a couple of values, not
 * inventing the whole payload from scratch.
 */
export const NODE_DEFAULT_PARAMS: Record<string, Record<string, unknown>> = {
  // ---- triggers ----
  webhook: { path: 'default', responseMode: 'immediately' },
  calendlyTrigger: { path: 'calendly', signingSecret: '' },
  docusignTrigger: { path: 'docusign', signingSecret: '' },
  chatTrigger: { path: 'default', responseMode: 'lastNode' },
  schedule: { cron: '0 * * * *' },
  rssTrigger: { feedUrl: 'https://example.com/feed.xml', pollIntervalMinutes: 15 },
  mqttTrigger: { topic: 'flowforge/events', host: 'localhost', port: 1883 },
  formTrigger: { path: 'contact', fields: [{ key: 'message', label: 'Message', type: 'text' }] },
  executeWorkflowTrigger: {},

  // ---- logic & flow ----
  filter: { conditions: [{ field: '{{$json.status}}', operator: 'equals', value: 'active' }] },
  merge: { mode: 'append' },
  wait: { seconds: 5 },
  forEach: { itemsField: '{{$json.items}}' },
  forEachBranch: {},
  subWorkflow: { workflowId: 'REPLACE_ME' },
  waitForWebhook: { path: 'resume' },
  respondToWebhook: { statusCode: 200, body: '{{$json}}' },
  humanApproval: { message: 'Please review and approve this step.', timeoutHours: 24 },

  // ---- data ----
  code: { code: 'return items.map(item => item);' },
  dataTableRead: { tableName: 'REPLACE_ME', filter: {} },
  dataTableWrite: { tableName: 'REPLACE_ME', operation: 'insert', data: {} },
  fileExtract: { binaryProperty: 'data' },
  fileConvert: { targetFormat: 'pdf' },

  // ---- comms integrations ----
  discord: { action: 'sendMessage', channelId: 'REPLACE_ME', content: 'Hello from FlowForge!' },
  telegram: { action: 'sendMessage', chatId: 'REPLACE_ME', text: 'Hello from FlowForge!' },
  email: { action: 'sendMail', to: 'REPLACE_ME@example.com', subject: 'Hello', body: 'Sent from FlowForge.' },
  msTeams: { action: 'sendMessage', text: 'Hello from FlowForge!' },
  outlook: { action: 'sendMail', to: 'REPLACE_ME@example.com', subject: 'Hello', body: 'Sent from FlowForge.' },

  // ---- docs/storage ----
  notion: { action: 'createPage', databaseId: 'REPLACE_ME', title: 'New page' },
  github: { action: 'createIssue', repo: 'owner/repo', title: 'New issue', body: '' },
  googleDrive: { action: 'listFiles', query: "name contains 'report'" },
  dropbox: { action: 'listFolder', path: '' },
  googleSheets: { action: 'appendRow', spreadsheetId: 'REPLACE_ME', range: 'Sheet1!A1', values: [] },
  sftp: { action: 'list', path: '/' },

  // ---- databases ----
  postgres: { query: 'SELECT NOW();' },
  mongodb: { action: 'find', collection: 'REPLACE_ME', filter: {} },
  mysql: { query: 'SELECT NOW();' },
  elasticsearch: { action: 'search', index: 'REPLACE_ME', query: { match_all: {} } },

  // ---- project management ----
  trello: { action: 'createCard', listId: 'REPLACE_ME', name: 'New card', desc: '' },
  asana: { action: 'createTask', projectId: 'REPLACE_ME', name: 'New task', notes: '' },
  clickup: { action: 'createTask', listId: 'REPLACE_ME', name: 'New task' },
  linear: { action: 'createIssue', teamId: 'REPLACE_ME', title: 'New issue', description: '' },
  jira: { action: 'createIssue', projectKey: 'REPLACE_ME', summary: 'New issue', issueType: 'Task' },

  // ---- meetings / scheduling ----
  zoom: { action: 'createMeeting', topic: 'FlowForge meeting', startTime: '', duration: 30 },
  calendly: { action: 'listEvents' },
  docusign: { action: 'getEnvelopeStatus', envelopeId: 'REPLACE_ME' },
  airtable: { action: 'list', baseId: 'REPLACE_ME', table: 'Table 1', maxRecords: 100 },

  // ---- monitoring / ops ----
  sentry: { action: 'listIssues' },
  pagerduty: { action: 'createIncident', title: 'New incident', urgency: 'high' },
  datadog: { action: 'postEvent', title: 'FlowForge event', text: 'Triggered from a workflow' },

  // ---- commerce / finance ----
  paypal: { action: 'createOrder', amount: '10.00', currency: 'USD' },
  quickbooks: { action: 'createInvoice' },
  xero: { action: 'createInvoice' },
  zendesk: { action: 'createTicket', subject: 'New ticket', body: '' },

  // ---- marketing ----
  mailchimp: { action: 'addSubscriber', listId: 'REPLACE_ME', email: 'REPLACE_ME@example.com' },
  sendgrid: { action: 'sendMail', to: 'REPLACE_ME@example.com', subject: 'Hello', body: 'Sent from FlowForge.' },
  segment: { action: 'track', event: 'FlowForge Event', userId: 'REPLACE_ME' },
  googleAds: { action: 'listCampaigns' },
  metaAds: { action: 'listCampaigns' },
  amplitude: { action: 'track', eventType: 'FlowForge Event', userId: 'REPLACE_ME' },
  mixpanel: { action: 'track', event: 'FlowForge Event', distinctId: 'REPLACE_ME' },

  // ---- social ----
  linkedin: { action: 'createPost', text: 'Posted from FlowForge 🚀', visibility: 'PUBLIC' },
  twitter: { action: 'createTweet', text: 'Posted from FlowForge 🚀' },
  facebook: { action: 'createPost', message: 'Posted from FlowForge 🚀' },
  instagram: { action: 'createPost', imageUrl: 'https://REPLACE_ME.example.com/image.jpg', caption: 'Posted from FlowForge 🚀' },
  youtube: { action: 'listVideos' },

  // ---- HTTP ----
  httpRequest: { method: 'GET', url: 'https://example.com', headers: {} },

  // ---- AI models / chains ----
  openai: { model: 'gpt-4o-mini', prompt: '{{$json.message}}', temperature: 0.7 },
  anthropic: { model: 'claude-sonnet-4-6', prompt: '{{$json.message}}', temperature: 0.7 },
  gemini: { model: 'gemini-2.0-flash', prompt: '{{$trigger.message}}', systemPrompt: 'You are a helpful assistant.', temperature: 0.3 },
  localLlm: { baseUrl: 'http://localhost:11434', model: 'llama3', prompt: '{{$json.message}}' },
  groq: { model: 'llama-3.3-70b-versatile', prompt: '{{$json.message}}', temperature: 0.7 },
  mistral: { model: 'mistral-large-latest', prompt: '{{$json.message}}', temperature: 0.7 },
  agent: { sessionId: '{{$trigger.sessionId}}', prompt: '{{$trigger.message}}', systemPrompt: 'You are a helpful assistant.', maxIterations: 8, recentTurns: 12, longTermMemory: false },
  agentOrchestrator: { strategy: 'sequential' },
  ragIngest: { embeddingProvider: 'openai', chunkSize: 1000, chunkOverlap: 150 },
  ragQuery: { embeddingProvider: 'openai', topK: 5 },
  embeddingProvider: { provider: 'openai' },
  textSplitterConfig: { strategy: 'fixed', chunkSize: 1000, chunkOverlap: 200 },
  vectorStoreConfig: { store: 'json', namespace: 'default' },
  redisMemory: { action: 'read', sessionId: '{{$trigger.sessionId}}', maxTurns: 20 },
  agentTool: { name: 'my_tool', description: 'Describe what this tool does and when the model should call it.', nodeType: 'httpRequest', nodeParams: '{}', parameters: '{}' },
  browserAutomation: {
    url: 'https://example.com',
    steps: [{ action: 'click', selector: '#login' }],
  },
};

/** Returns a fresh copy of the default params for a node type, or `{}` if none are defined. */
export function getDefaultParams(nodeType: string): Record<string, unknown> {
  const defaults = NODE_DEFAULT_PARAMS[nodeType];
  return defaults ? JSON.parse(JSON.stringify(defaults)) : {};
}

/**
 * Sample `$json` payload for trigger node types, used to seed the "Mock
 * input" box in NodeConfigPanel's test panel when a trigger has no
 * upstream node (so no `upstreamOutput` to prefill from) and no saved
 * session value yet.
 *
 * Without this, trigger nodes defaulted to mock input `{}` — a technically
 * valid but empty payload — so every `{{$json.field}}` expression on the
 * trigger itself, and on every downstream node that seeds its own default
 * mock from the trigger's last-run output, resolved to nothing on first
 * test. This is the fix: give each trigger a realistic shape out of the
 * box (matching what apps/worker/src/nodes/triggerNodes.ts actually seeds
 * `input` with at real runtime) so `{{$json.message}}`, `{{$json.sessionId}}`,
 * etc. resolve immediately, the same way n8n's trigger nodes ship with
 * sample data pre-filled.
 */
export const NODE_DEFAULT_MOCK_INPUT: Record<string, unknown> = {
  chatTrigger: { sessionId: 'test-session-1', message: 'Hello, how can you help me?', attachments: [] },
  webhook: { headers: { 'content-type': 'application/json' }, query: {}, body: { example: 'value' } },
  formTrigger: { message: 'Sample form submission' },
  rssTrigger: { id: 'item-1', title: 'Sample feed item', link: 'https://example.com/post', pubDate: new Date().toISOString() },
  mqttTrigger: { topic: 'flowforge/events', value: 'sample payload' },
  schedule: { triggeredAt: new Date().toISOString() },
  calendlyTrigger: {
    event: 'invitee.created',
    payload: {
      event_type: { name: '30 Minute Meeting' },
      invitee: { name: 'Jamie Doe', email: 'jamie@example.com' },
      event: { start_time: new Date().toISOString(), uri: 'https://api.calendly.com/scheduled_events/EXAMPLE' },
    },
  },
  docusignTrigger: {
    event: 'envelope-completed',
    data: { envelopeId: 'EXAMPLE-ENVELOPE-ID', envelopeSummary: { status: 'completed' } },
  },
};

/** Returns the sample mock-input payload for a trigger node type, or `undefined` if none is defined. */
export function getDefaultMockInput(nodeType: string): unknown {
  const sample = NODE_DEFAULT_MOCK_INPUT[nodeType];
  return sample ? JSON.parse(JSON.stringify(sample)) : undefined;
}