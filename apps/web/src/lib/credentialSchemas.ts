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
  ragIngest: 'openai',
  ragQuery: 'openai',
  agent: 'openai',
  agentMemory: 'openai',
  agentOrchestrator: 'openai',
  // browserAutomation has no credential type of its own yet (uses
  // BROWSER_RUNNER_URL/KEY env vars) — omitted on purpose so the node panel
  // shows a generic "any credential" picker instead of a broken filter.
};
