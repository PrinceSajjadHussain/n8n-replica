import { OAUTH_PROVIDERS } from '../config/oauthProviders';

export interface TestResult {
  ok: boolean;
  message: string;
}

/**
 * Attempts to verify that stored credential data is still valid by making a
 * minimal, side-effect-free request to the relevant provider.
 */
export async function testCredentialConnection(
  type: string,
  data: Record<string, unknown>
): Promise<TestResult> {
  try {
    // OAuth2 connections: hit the provider's lightweight identity/auth-check endpoint.
    const oauthProvider = Object.entries(OAUTH_PROVIDERS).find(([, cfg]) => cfg.credentialType === type);
    if (oauthProvider) {
      const [providerId, config] = oauthProvider;
      const accessToken = data.accessToken as string | undefined;
      if (!accessToken) return { ok: false, message: 'No access token stored for this connection.' };
      if (!config.testUrl) return { ok: true, message: 'Connected (no live check available for this provider).' };

      if (providerId === 'slack') {
        const res = await fetch(config.testUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const json = (await res.json()) as { ok: boolean; error?: string; team?: string; user?: string };
        if (!json.ok) return { ok: false, message: json.error ?? 'Slack rejected the token.' };
        return { ok: true, message: `Connected to Slack as ${json.user ?? 'unknown user'} (${json.team ?? 'workspace'}).` };
      }

      const res = await fetch(config.testUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) return { ok: false, message: `${config.displayName} responded with ${res.status}.` };
      const json = (await res.json()) as Record<string, unknown>;
      const identity = (json.email ?? json.login ?? json.name ?? 'connected account') as string;
      return { ok: true, message: `Connected to ${config.displayName} as ${identity}.` };
    }

    switch (type) {
      case 'httpBearer': {
        const testUrl = data.testUrl as string | undefined;
        const token = data.token as string | undefined;
        if (!token) return { ok: false, message: 'No token stored for this credential.' };
        if (!testUrl) return { ok: true, message: 'Token stored (add a "testUrl" field to enable a live check).' };
        const res = await fetch(testUrl, { headers: { Authorization: `Bearer ${token}` } });
        return res.ok
          ? { ok: true, message: `Test request succeeded (${res.status}).` }
          : { ok: false, message: `Test request failed (${res.status}).` };
      }
      case 'slack': {
        const webhookUrl = data.webhookUrl as string | undefined;
        if (!webhookUrl) return { ok: false, message: 'No webhook URL stored.' };
        // Slack doesn't offer a no-op verification for incoming webhooks; validate the shape instead.
        const valid = /^https:\/\/hooks\.slack\.com\/services\//.test(webhookUrl);
        return valid
          ? { ok: true, message: 'Webhook URL looks valid. (Slack has no dry-run endpoint for incoming webhooks.)' }
          : { ok: false, message: 'That does not look like a Slack incoming webhook URL.' };
      }
      case 'openai': {
        const apiKey = data.apiKey as string | undefined;
        if (!apiKey) return { ok: false, message: 'No API key stored.' };
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return res.ok
          ? { ok: true, message: 'OpenAI API key is valid.' }
          : { ok: false, message: `OpenAI rejected the key (${res.status}).` };
      }
      case 'googleSheets': {
        // Legacy static-token credential type, kept for backwards compatibility.
        const accessToken = data.accessToken as string | undefined;
        if (!accessToken) return { ok: false, message: 'No access token stored.' };
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        return res.ok ? { ok: true, message: 'Google token is valid.' } : { ok: false, message: `Google rejected the token (${res.status}).` };
      }
      case 'email':
        return { ok: true, message: 'Email credential stored. (No live check available — send a test workflow to verify.)' };
      case 'discord': {
        const webhookUrl = data.webhookUrl as string | undefined;
        if (!webhookUrl) return { ok: false, message: 'No webhook URL stored.' };
        const valid = /^https:\/\/discord\.com\/api\/webhooks\//.test(webhookUrl);
        if (!valid) return { ok: false, message: 'That does not look like a Discord webhook URL.' };
        const res = await fetch(webhookUrl);
        return res.ok
          ? { ok: true, message: 'Discord webhook exists and is reachable.' }
          : { ok: false, message: `Discord rejected the webhook (${res.status}).` };
      }
      case 'telegram': {
        const botToken = data.botToken as string | undefined;
        if (!botToken) return { ok: false, message: 'No bot token stored.' };
        const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
        const json = (await res.json()) as { ok: boolean; result?: { username?: string }; description?: string };
        return json.ok
          ? { ok: true, message: `Connected as @${json.result?.username ?? 'bot'}.` }
          : { ok: false, message: json.description ?? 'Telegram rejected the bot token.' };
      }
      case 'notion': {
        const apiKey = data.apiKey as string | undefined;
        if (!apiKey) return { ok: false, message: 'No API key stored.' };
        const res = await fetch('https://api.notion.com/v1/users/me', {
          headers: { Authorization: `Bearer ${apiKey}`, 'Notion-Version': '2022-06-28' },
        });
        return res.ok
          ? { ok: true, message: 'Notion integration secret is valid.' }
          : { ok: false, message: `Notion rejected the secret (${res.status}).` };
      }
      case 'github': {
        const token = data.token as string | undefined;
        if (!token) return { ok: false, message: 'No token stored.' };
        const res = await fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        });
        if (!res.ok) return { ok: false, message: `GitHub rejected the token (${res.status}).` };
        const json = (await res.json()) as { login?: string };
        return { ok: true, message: `Connected to GitHub as ${json.login ?? 'unknown user'}.` };
      }
      case 'postgres': {
        const connectionString = data.connectionString as string | undefined;
        if (!connectionString) return { ok: false, message: 'No connection string stored.' };
        const { Client } = await import('pg');
        const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
        try {
          await client.connect();
          await client.query('SELECT 1');
          return { ok: true, message: 'Connected to Postgres successfully.' };
        } finally {
          await client.end().catch(() => {});
        }
      }
      case 'sendgrid': {
        const apiKey = data.apiKey as string | undefined;
        if (!apiKey) return { ok: false, message: 'No API key stored.' };
        const res = await fetch('https://api.sendgrid.com/v3/user/account', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return res.ok
          ? { ok: true, message: 'SendGrid API key is valid.' }
          : { ok: false, message: `SendGrid rejected the key (${res.status}).` };
      }
      case 'mailchimp': {
        const apiKey = data.apiKey as string | undefined;
        if (!apiKey) return { ok: false, message: 'No API key stored.' };
        const dc = apiKey.split('-').pop();
        if (!dc) return { ok: false, message: 'API key is missing the "-usXX" datacenter suffix.' };
        const res = await fetch(`https://${dc}.api.mailchimp.com/3.0/ping`, {
          headers: { Authorization: `Basic ${Buffer.from(`anystring:${apiKey}`).toString('base64')}` },
        });
        return res.ok
          ? { ok: true, message: 'Mailchimp API key is valid.' }
          : { ok: false, message: `Mailchimp rejected the key (${res.status}).` };
      }
      case 'zendesk': {
        const { subdomain, email, apiToken } = data as { subdomain?: string; email?: string; apiToken?: string };
        if (!subdomain || !email || !apiToken) return { ok: false, message: 'Subdomain, email, and API token are all required.' };
        const res = await fetch(`https://${subdomain}.zendesk.com/api/v2/users/me.json`, {
          headers: { Authorization: `Basic ${Buffer.from(`${email}/token:${apiToken}`).toString('base64')}` },
        });
        return res.ok
          ? { ok: true, message: 'Zendesk credentials are valid.' }
          : { ok: false, message: `Zendesk rejected the credentials (${res.status}).` };
      }
      case 'calendly': {
        const apiToken = data.apiToken as string | undefined;
        if (!apiToken) return { ok: false, message: 'No API token stored.' };
        const res = await fetch('https://api.calendly.com/users/me', { headers: { Authorization: `Bearer ${apiToken}` } });
        return res.ok
          ? { ok: true, message: 'Calendly token is valid.' }
          : { ok: false, message: `Calendly rejected the token (${res.status}).` };
      }
      case 'airtable': {
        const apiKey = data.apiKey as string | undefined;
        if (!apiKey) return { ok: false, message: 'No personal access token stored.' };
        // /v0/meta/whoami is the lightest authenticated Airtable endpoint —
        // confirms the token itself is valid without needing a base id.
        const res = await fetch('https://api.airtable.com/v0/meta/whoami', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return res.ok
          ? { ok: true, message: 'Airtable token is valid.' }
          : { ok: false, message: `Airtable rejected the token (${res.status}).` };
      }
      case 'amplitude':
      case 'mixpanel':
      case 'segment':
        return { ok: true, message: 'Key stored. (Analytics ingestion endpoints have no dry-run/identity check — send a test event to verify.)' };
      case 'elasticsearch': {
        const node = data.node as string | undefined;
        if (!node) return { ok: false, message: 'No cluster URL stored.' };
        const headers: Record<string, string> = {};
        if (data.apiKey) headers.Authorization = `ApiKey ${data.apiKey}`;
        const res = await fetch(node, { headers });
        return res.ok
          ? { ok: true, message: 'Elasticsearch cluster is reachable.' }
          : { ok: false, message: `Cluster responded with ${res.status}.` };
      }
      default:
        return { ok: true, message: 'No automated test is defined for this credential type yet.' };
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Test connection failed unexpectedly.' };
  }
}
