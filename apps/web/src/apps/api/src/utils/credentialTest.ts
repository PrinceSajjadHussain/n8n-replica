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
      default:
        return { ok: true, message: 'No automated test is defined for this credential type yet.' };
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Test connection failed unexpectedly.' };
  }
}
