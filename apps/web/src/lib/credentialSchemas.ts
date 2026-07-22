/**
 * Single source of truth for "which credential types exist, and what fields
 * does each one need". Used by CredentialsPage (full management UI) and
 * CredentialQuickCreateModal (inline "+ New credential" from a node panel).
 *
 * Field keys here MUST match what each worker node reads out of
 * `credential` — see apps/worker/src/nodes/*.ts for the source of truth.
 */

export const CREDENTIAL_TYPES = [
  'slack',
  'discord',
  'telegram',
  'notion',
  'github',
  'postgres',
  'httpBearer',
  'email',
  'googleSheets',
  'openai',
  'anthropic',
  'gemini',
  'localLlm',
  'groq',
  'mistral',
  'trello',
  'asana',
  'clickup',
  'linear',
  'jira',
  'msTeams',
  'dropbox',
  'zoom',
  'mongodb',
  'mysql',
  'sentry',
  'pagerduty',
  'datadog',
  'outlook',
  'googleDrive',
  'paypal',
  'quickbooks',
  'xero',
  'zendesk',
  'mailchimp',
  'sendgrid',
  'segment',
  'googleAds',
  'metaAds',
  'amplitude',
  'mixpanel',
  'calendly',
  'docusign',
  'airtable',
  'elasticsearch',
  'sftp',
  'linkedin',
  'twitter',
  'facebook',
  'instagram',
  'youtube',
] as const;

export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export type FieldType = 'text' | 'password' | 'select' | 'info';

export interface CredentialField {
  key: string;
  label: string;
  fieldType: FieldType;
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  helpText?: string;
}

/** Human-friendly display name + brand-ish color, used for icons/badges across the UI. */
export const CREDENTIAL_TYPE_META: Record<CredentialType, { label: string; color: string; letter: string }> = {
  slack: { label: 'Slack', color: '#4A154B', letter: 'S' },
  discord: { label: 'Discord', color: '#5865F2', letter: 'D' },
  telegram: { label: 'Telegram', color: '#26A5E4', letter: 'T' },
  notion: { label: 'Notion', color: '#000000', letter: 'N' },
  github: { label: 'GitHub', color: '#24292F', letter: 'G' },
  postgres: { label: 'Postgres', color: '#336791', letter: 'P' },
  httpBearer: { label: 'HTTP Bearer', color: '#6B7280', letter: 'H' },
  email: { label: 'Email', color: '#EA4335', letter: 'E' },
  googleSheets: { label: 'Google Sheets', color: '#0F9D58', letter: 'G' },
  openai: { label: 'OpenAI', color: '#10A37F', letter: 'AI' },
  anthropic: { label: 'Anthropic', color: '#D97757', letter: 'A' },
  gemini: { label: 'Gemini', color: '#4285F4', letter: 'G' },
  localLlm: { label: 'Local LLM (Ollama / vLLM)', color: '#6B7280', letter: 'L' },
  groq: { label: 'Groq', color: '#F55036', letter: 'G' },
  mistral: { label: 'Mistral', color: '#FA520F', letter: 'M' },
  trello: { label: 'Trello', color: '#0052CC', letter: 'T' },
  asana: { label: 'Asana', color: '#F06A6A', letter: 'A' },
  clickup: { label: 'ClickUp', color: '#7B68EE', letter: 'C' },
  linear: { label: 'Linear', color: '#5E6AD2', letter: 'L' },
  jira: { label: 'Jira', color: '#0052CC', letter: 'J' },
  msTeams: { label: 'Microsoft Teams', color: '#6264A7', letter: 'T' },
  dropbox: { label: 'Dropbox', color: '#0061FF', letter: 'D' },
  zoom: { label: 'Zoom', color: '#2D8CFF', letter: 'Z' },
  mongodb: { label: 'MongoDB', color: '#47A248', letter: 'M' },
  mysql: { label: 'MySQL', color: '#4479A1', letter: 'M' },
  sentry: { label: 'Sentry', color: '#362D59', letter: 'S' },
  pagerduty: { label: 'PagerDuty', color: '#06AC38', letter: 'P' },
  datadog: { label: 'Datadog', color: '#632CA6', letter: 'D' },
  outlook: { label: 'Outlook', color: '#0078D4', letter: 'O' },
  googleDrive: { label: 'Google Drive', color: '#0F9D58', letter: 'G' },
  paypal: { label: 'PayPal', color: '#00457C', letter: 'P' },
  quickbooks: { label: 'QuickBooks', color: '#2CA01C', letter: 'Q' },
  xero: { label: 'Xero', color: '#13B5EA', letter: 'X' },
  zendesk: { label: 'Zendesk', color: '#03363D', letter: 'Z' },
  mailchimp: { label: 'Mailchimp', color: '#FFE01B', letter: 'M' },
  sendgrid: { label: 'SendGrid', color: '#51A9E3', letter: 'S' },
  segment: { label: 'Segment', color: '#52BD94', letter: 'S' },
  googleAds: { label: 'Google Ads', color: '#4285F4', letter: 'G' },
  metaAds: { label: 'Meta Ads', color: '#0081FB', letter: 'M' },
  amplitude: { label: 'Amplitude', color: '#0A80E4', letter: 'A' },
  mixpanel: { label: 'Mixpanel', color: '#7856FF', letter: 'M' },
  calendly: { label: 'Calendly', color: '#006BFF', letter: 'C' },
  docusign: { label: 'DocuSign', color: '#FFCC22', letter: 'D' },
  airtable: { label: 'Airtable', color: '#FCB400', letter: 'A' },
  elasticsearch: { label: 'Elasticsearch', color: '#005571', letter: 'E' },
  sftp: { label: 'SFTP / FTP', color: '#6B7280', letter: 'F' },
  linkedin: { label: 'LinkedIn', color: '#0A66C2', letter: 'L' },
  twitter: { label: 'X (Twitter)', color: '#000000', letter: 'X' },
  facebook: { label: 'Facebook', color: '#0866FF', letter: 'F' },
  instagram: { label: 'Instagram', color: '#E4405F', letter: 'I' },
  youtube: { label: 'YouTube', color: '#FF0000', letter: 'Y' },
};

export const CREDENTIAL_FIELDS: Record<CredentialType, CredentialField[]> = {
  slack: [
    {
      key: 'webhookUrl',
      label: 'Incoming Webhook URL',
      fieldType: 'password',
      required: true,
      placeholder: 'https://hooks.slack.com/services/T000/B000/XXXX',
      helpText: 'Create one at api.slack.com/apps → Incoming Webhooks.',
    },
  ],
  discord: [
    {
      key: 'webhookUrl',
      label: 'Webhook URL',
      fieldType: 'password',
      required: true,
      placeholder: 'https://discord.com/api/webhooks/...',
      helpText: 'Server Settings → Integrations → Webhooks in Discord.',
    },
  ],
  telegram: [
    {
      key: 'botToken',
      label: 'Bot token',
      fieldType: 'password',
      required: true,
      placeholder: '123456:ABC-DEF...',
      helpText: 'Create a bot with @BotFather on Telegram to get a token.',
    },
  ],
  notion: [
    {
      key: 'apiKey',
      label: 'Internal integration secret',
      fieldType: 'password',
      required: true,
      placeholder: 'secret_...',
      helpText: 'From notion.so/my-integrations — remember to share the target page/database with the integration.',
    },
  ],
  github: [
    {
      key: 'token',
      label: 'Personal access token',
      fieldType: 'password',
      required: true,
      placeholder: 'ghp_...',
      helpText: 'github.com/settings/tokens — needs repo scope for private repos.',
    },
  ],
  postgres: [
    {
      key: 'connectionString',
      label: 'Connection string',
      fieldType: 'password',
      required: true,
      placeholder: 'postgresql://user:pass@host:5432/db',
      helpText: 'This is a target database for the Postgres node to query — not FlowForge\u2019s own database.',
    },
  ],
  httpBearer: [
    {
      key: 'token',
      label: 'Bearer token',
      fieldType: 'password',
      required: true,
      placeholder: 'sk_live_...',
      helpText: 'Sent as the Authorization header on HTTP Request nodes.',
    },
    {
      key: 'testUrl',
      label: 'Test URL (optional)',
      fieldType: 'text',
      placeholder: 'https://api.example.com/me',
      helpText: 'Used by "Test connection" — omit to skip the live check.',
    },
  ],
  email: [
    {
      key: 'provider',
      label: 'Provider',
      fieldType: 'select',
      required: true,
      options: [
        { value: 'resend', label: 'Resend' },
        { value: 'sendgrid', label: 'SendGrid' },
      ],
    },
    {
      key: 'apiKey',
      label: 'API key',
      fieldType: 'password',
      placeholder: 'Leave blank to use the server-wide key',
      helpText: 'Optional — omit to fall back to the server-wide key.',
    },
    {
      key: 'from',
      label: 'From address',
      fieldType: 'text',
      placeholder: 'alerts@yourdomain.com',
    },
  ],
  googleSheets: [
    {
      key: 'note',
      label: '',
      fieldType: 'info',
      helpText:
        'Use "Connect with Google" on the Credentials page instead — it stores a real OAuth token this node can use directly. This manual form is only a fallback.',
    },
  ],
  openai: [
    {
      key: 'apiKey',
      label: 'API key',
      fieldType: 'password',
      required: true,
      placeholder: 'sk-...',
      helpText: 'From platform.openai.com/api-keys.',
    },
  ],
  anthropic: [
    {
      key: 'apiKey',
      label: 'API key',
      fieldType: 'password',
      required: true,
      placeholder: 'sk-ant-...',
      helpText: 'From console.anthropic.com/settings/keys.',
    },
  ],
  gemini: [
    {
      key: 'apiKey',
      label: 'API key',
      fieldType: 'password',
      required: true,
      placeholder: 'AIza...',
      helpText: 'From aistudio.google.com/apikey. Used for both the Gemini node and as the "gemini" embeddingProvider/answerProvider option on RAG nodes.',
    },
  ],
  localLlm: [
    {
      key: 'apiKey',
      label: 'API key',
      fieldType: 'password',
      required: false,
      placeholder: '(optional)',
      helpText:
        'Leave empty for a local, unauthenticated Ollama/vLLM/LM Studio server (the vast majority of setups). ' +
        'Only set this if your server enforces a bearer token (e.g. vLLM started with --api-key).',
    },
  ],
  groq: [
    {
      key: 'apiKey',
      label: 'API key',
      fieldType: 'password',
      required: true,
      placeholder: 'gsk_...',
      helpText: 'From console.groq.com/keys.',
    },
  ],
  mistral: [
    {
      key: 'apiKey',
      label: 'API key',
      fieldType: 'password',
      required: true,
      placeholder: '...',
      helpText: 'From console.mistral.ai/api-keys.',
    },
  ],
  trello: [
    { key: 'apiKey', label: 'API key', fieldType: 'password', required: true, placeholder: '...', helpText: 'From trello.com/app-key.' },
    { key: 'token', label: 'Token', fieldType: 'password', required: true, placeholder: '...', helpText: 'Generate a token from the same app-key page.' },
  ],
  asana: [
    {
      key: 'accessToken',
      label: 'Personal access token',
      fieldType: 'password',
      required: true,
      placeholder: '2/...',
      helpText: 'From your Asana profile settings → Apps → Manage Developer Apps → Personal Access Tokens.',
    },
  ],
  clickup: [
    {
      key: 'apiToken',
      label: 'API token',
      fieldType: 'password',
      required: true,
      placeholder: 'pk_...',
      helpText: 'From ClickUp settings → Apps.',
    },
  ],
  linear: [
    {
      key: 'apiKey',
      label: 'API key',
      fieldType: 'password',
      required: true,
      placeholder: 'lin_api_...',
      helpText: 'From Linear settings → Security & access → Personal API keys.',
    },
  ],
  jira: [
    { key: 'siteUrl', label: 'Site URL', fieldType: 'text', required: true, placeholder: 'https://yourorg.atlassian.net' },
    { key: 'email', label: 'Account email', fieldType: 'text', required: true, placeholder: 'you@yourorg.com' },
    {
      key: 'apiToken',
      label: 'API token',
      fieldType: 'password',
      required: true,
      placeholder: '...',
      helpText: 'From id.atlassian.com/manage-profile/security/api-tokens.',
    },
  ],
  msTeams: [
    {
      key: 'webhookUrl',
      label: 'Incoming Webhook URL',
      fieldType: 'password',
      required: true,
      placeholder: 'https://...webhook.office.com/webhookb2/...',
      helpText: 'Channel → Connectors → Incoming Webhook in Microsoft Teams.',
    },
  ],
  dropbox: [
    {
      key: 'accessToken',
      label: 'Access token',
      fieldType: 'password',
      required: true,
      placeholder: 'sl.u.-...',
      helpText: 'Generate from your app on the Dropbox App Console.',
    },
  ],
  zoom: [
    {
      key: 'accessToken',
      label: 'Access token',
      fieldType: 'password',
      required: true,
      placeholder: '...',
      helpText: 'Server-to-Server OAuth app token from the Zoom App Marketplace — short-lived, may need periodic refresh.',
    },
  ],
  mongodb: [
    {
      key: 'connectionString',
      label: 'Connection string',
      fieldType: 'password',
      required: true,
      placeholder: 'mongodb+srv://user:pass@cluster.mongodb.net',
      helpText: 'This is a target database for the MongoDB node to query — not FlowForge\u2019s own database.',
    },
  ],
  mysql: [
    {
      key: 'connectionString',
      label: 'Connection string',
      fieldType: 'password',
      required: true,
      placeholder: 'mysql://user:pass@host:3306/db',
      helpText: 'This is a target database for the MySQL node to query — not FlowForge\u2019s own database.',
    },
  ],
  sentry: [
    { key: 'organizationSlug', label: 'Organization slug', fieldType: 'text', required: true, placeholder: 'my-org' },
    {
      key: 'authToken',
      label: 'Auth token',
      fieldType: 'password',
      required: true,
      placeholder: '...',
      helpText: 'From Sentry → Settings → Auth Tokens (needs project:read/write scopes).',
    },
  ],
  pagerduty: [
    {
      key: 'routingKey',
      label: 'Events API routing key',
      fieldType: 'password',
      placeholder: '...',
      helpText: 'From a PagerDuty service\u2019s Integrations tab (Events API v2) — needed for trigger/acknowledge/resolve.',
    },
    {
      key: 'apiToken',
      label: 'REST API token (optional)',
      fieldType: 'password',
      placeholder: '...',
      helpText: 'From PagerDuty → My Profile → User Settings — only needed for listing incidents.',
    },
  ],
  datadog: [
    { key: 'apiKey', label: 'API key', fieldType: 'password', required: true, placeholder: '...', helpText: 'Organization Settings → API Keys.' },
    {
      key: 'appKey',
      label: 'Application key (optional)',
      fieldType: 'password',
      placeholder: '...',
      helpText: 'Only needed for querying metrics, not submitting them.',
    },
    {
      key: 'site',
      label: 'Site (optional)',
      fieldType: 'text',
      placeholder: 'datadoghq.com',
      helpText: 'Defaults to datadoghq.com — use datadoghq.eu etc. for other regions.',
    },
  ],
  outlook: [
    {
      key: 'note',
      label: '',
      fieldType: 'info',
      helpText: 'Use "Connect with Microsoft" on the Credentials page instead — it stores a real OAuth token this node can use directly. This manual form is only a fallback.',
    },
  ],
  googleDrive: [
    {
      key: 'note',
      label: '',
      fieldType: 'info',
      helpText: 'Use "Connect with Google" on the Credentials page instead — the same OAuth credential used by Google Sheets/Gmail/Calendar works here since Drive scope is already requested.',
    },
  ],
  paypal: [
    { key: 'clientId', label: 'Client ID', fieldType: 'text', required: true, placeholder: 'AZ...' },
    { key: 'clientSecret', label: 'Client secret', fieldType: 'password', required: true },
    {
      key: 'mode',
      label: 'Mode',
      fieldType: 'select',
      required: true,
      options: [
        { value: 'sandbox', label: 'Sandbox' },
        { value: 'live', label: 'Live' },
      ],
      helpText: 'From your app in the PayPal Developer Dashboard.',
    },
  ],
  quickbooks: [
    { key: 'accessToken', label: 'Access token', fieldType: 'password', required: true, helpText: 'Short-lived — reconnect from the Intuit developer OAuth playground if this expires.' },
    { key: 'realmId', label: 'Realm ID (Company ID)', fieldType: 'text', required: true },
    {
      key: 'environment',
      label: 'Environment',
      fieldType: 'select',
      options: [
        { value: 'sandbox', label: 'Sandbox' },
        { value: 'production', label: 'Production' },
      ],
    },
  ],
  xero: [
    { key: 'accessToken', label: 'Access token', fieldType: 'password', required: true },
    { key: 'tenantId', label: 'Tenant ID', fieldType: 'text', required: true, helpText: 'From the /connections endpoint after Xero OAuth.' },
  ],
  zendesk: [
    { key: 'subdomain', label: 'Subdomain', fieldType: 'text', required: true, placeholder: 'yourcompany' },
    { key: 'email', label: 'Account email', fieldType: 'text', required: true },
    { key: 'apiToken', label: 'API token', fieldType: 'password', required: true, helpText: 'Admin Center → Apps and integrations → APIs → Zendesk API.' },
  ],
  mailchimp: [
    { key: 'apiKey', label: 'API key', fieldType: 'password', required: true, placeholder: 'abc123...-us21', helpText: 'From Account → Extras → API keys. Must include the "-usXX" datacenter suffix.' },
  ],
  sendgrid: [
    { key: 'apiKey', label: 'API key', fieldType: 'password', required: true },
  ],
  segment: [
    { key: 'writeKey', label: 'Write key', fieldType: 'password', required: true, helpText: 'Source settings → API Keys in Segment.' },
  ],
  googleAds: [
    { key: 'accessToken', label: 'Access token', fieldType: 'password', required: true },
    { key: 'developerToken', label: 'Developer token', fieldType: 'password', required: true },
    { key: 'customerId', label: 'Customer ID', fieldType: 'text', required: true, placeholder: '1234567890' },
    { key: 'loginCustomerId', label: 'Login customer ID (MCC)', fieldType: 'text', helpText: 'Only needed when querying via a manager account.' },
  ],
  metaAds: [
    { key: 'accessToken', label: 'Access token', fieldType: 'password', required: true },
    { key: 'adAccountId', label: 'Ad account ID', fieldType: 'text', required: true, placeholder: 'act_1234567890' },
  ],
  amplitude: [
    { key: 'apiKey', label: 'API key', fieldType: 'password', required: true },
  ],
  mixpanel: [
    { key: 'projectToken', label: 'Project token', fieldType: 'password', required: true },
  ],
  calendly: [
    { key: 'apiToken', label: 'Personal access token', fieldType: 'password', required: true, helpText: 'Calendly → Integrations → API & Webhooks.' },
  ],
  docusign: [
    { key: 'accessToken', label: 'Access token', fieldType: 'password', required: true },
    { key: 'accountId', label: 'Account ID', fieldType: 'text', required: true },
    { key: 'basePath', label: 'Base path', fieldType: 'text', placeholder: 'https://demo.docusign.net/restapi', helpText: 'Defaults to the demo/sandbox base — use your production base URI for live use.' },
  ],
  airtable: [
    { key: 'apiKey', label: 'Personal access token', fieldType: 'password', required: true, helpText: 'airtable.com/create/tokens — needs data.records:read (and :write for create/update/delete) on the target base.' },
  ],
  elasticsearch: [
    { key: 'node', label: 'Cluster URL', fieldType: 'text', required: true, placeholder: 'https://my-cluster.es.io:9243' },
    { key: 'apiKey', label: 'API key', fieldType: 'password', helpText: 'Use this OR username/password below, not both.' },
    { key: 'username', label: 'Username', fieldType: 'text' },
    { key: 'password', label: 'Password', fieldType: 'password' },
  ],
  sftp: [
    { key: 'host', label: 'Host', fieldType: 'text', required: true },
    { key: 'port', label: 'Port', fieldType: 'text', placeholder: '22 (sftp) / 21 (ftp)' },
    { key: 'username', label: 'Username', fieldType: 'text', required: true },
    { key: 'password', label: 'Password', fieldType: 'password' },
    { key: 'privateKey', label: 'Private key (SFTP only)', fieldType: 'password', helpText: 'PEM-format key content, if using key-based auth instead of a password.' },
  ],
  linkedin: [
    { key: 'accessToken', label: 'Access token', fieldType: 'password', required: true },
    { key: 'authorUrn', label: 'Author URN', fieldType: 'text', required: true, placeholder: 'urn:li:person:xxxx', helpText: 'Fetch once via GET /v2/me, or your organization URN for a company page.' },
  ],
  twitter: [
    { key: 'accessToken', label: 'Access token', fieldType: 'password', required: true, helpText: 'User-context OAuth 2.0 token with tweet.write scope — an app-only bearer token cannot post.' },
  ],
  facebook: [
    { key: 'pageAccessToken', label: 'Page access token', fieldType: 'password', required: true },
    { key: 'pageId', label: 'Page ID', fieldType: 'text', required: true },
  ],
  instagram: [
    { key: 'pageAccessToken', label: 'Page access token', fieldType: 'password', required: true, helpText: 'Instagram Business publishing rides on a connected Facebook Page token.' },
    { key: 'igUserId', label: 'Instagram Business user ID', fieldType: 'text', required: true },
  ],
  youtube: [
    {
      key: 'note',
      label: '',
      fieldType: 'info',
      helpText: 'Use "Connect with Google" on the Credentials page (with YouTube scope granted) instead of pasting a token manually where possible.',
    },
    { key: 'accessToken', label: 'Access token', fieldType: 'password', required: true },
  ],
};

export function defaultFieldValues(type: CredentialType): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of CREDENTIAL_FIELDS[type]) {
    if (field.fieldType === 'info') continue;
    values[field.key] = field.fieldType === 'select' ? field.options?.[0]?.value ?? '' : '';
  }
  return values;
}

/**
 * Maps a node type to the credential type it expects, so the node panel can
 * pre-select and pre-filter the right kind of credential. Node types not
 * listed here don't use credentials at all.
 */
export const NODE_TYPE_TO_CREDENTIAL_TYPE: Record<string, CredentialType> = {
  slack: 'slack',
  discord: 'discord',
  telegram: 'telegram',
  notion: 'notion',
  github: 'github',
  postgres: 'postgres',
  httpRequest: 'httpBearer',
  email: 'email',
  googleSheets: 'googleSheets',
  openai: 'openai',
  anthropic: 'anthropic',
  gemini: 'gemini',
  localLlm: 'localLlm',
  groq: 'groq',
  mistral: 'mistral',
  // textClassifier/sentimentAnalysis/entityExtractor/summarizer/qaChain all
  // support provider: 'openai' | 'anthropic' | 'gemini' via params.provider,
  // same as ragIngest/ragQuery/agent above — mapped to 'openai' as the
  // default-selected credential type, not a strict filter.
  textClassifier: 'openai',
  sentimentAnalysis: 'openai',
  entityExtractor: 'openai',
  summarizer: 'openai',
  qaChain: 'openai',
  // ragIngest/ragQuery default to an 'openai' credential (embeddingProvider:
  // 'openai' is the default), but also accept a 'gemini' credential when
  // params.embeddingProvider/answerProvider is set to 'gemini' — omitted
  // from strict filtering here so the node panel's credential picker shows
  // both rather than hiding the one actually needed for that config.
  ragIngest: 'openai',
  ragQuery: 'openai',
  agent: 'openai',
  agentMemory: 'openai',
  agentOrchestrator: 'openai',
  // browserAutomation has no credential type of its own yet (uses
  // BROWSER_RUNNER_URL/KEY env vars) — omitted on purpose so the node panel
  // shows a generic "any credential" picker instead of a broken filter.
  trello: 'trello',
  asana: 'asana',
  clickup: 'clickup',
  linear: 'linear',
  jira: 'jira',
  msTeams: 'msTeams',
  outlook: 'outlook',
  googleDrive: 'googleDrive',
  dropbox: 'dropbox',
  zoom: 'zoom',
  mongodb: 'mongodb',
  mysql: 'mysql',
  sentry: 'sentry',
  pagerduty: 'pagerduty',
  datadog: 'datadog',
  paypal: 'paypal',
  quickbooks: 'quickbooks',
  xero: 'xero',
  zendesk: 'zendesk',
  mailchimp: 'mailchimp',
  sendgrid: 'sendgrid',
  segment: 'segment',
  googleAds: 'googleAds',
  metaAds: 'metaAds',
  amplitude: 'amplitude',
  mixpanel: 'mixpanel',
  calendly: 'calendly',
  docusign: 'docusign',
  airtable: 'airtable',
  elasticsearch: 'elasticsearch',
  sftp: 'sftp',
  linkedin: 'linkedin',
  twitter: 'twitter',
  facebook: 'facebook',
  instagram: 'instagram',
  youtube: 'youtube',
};
