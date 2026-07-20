/**
 * oauthProviders.ts — API-side OAuth provider config.
 *
 * tokenUrl / clientIdEnv / clientSecretEnv are now imported from
 * @flowforge/shared-types (OAUTH_TOKEN_PROVIDERS) rather than re-declared
 * here — this is the "define once, share" fix from n8n audit section 16,
 * ensuring the token endpoint the API uses for the initial exchange is
 * always the same one the worker uses for refresh, with no drift possible.
 *
 * The fields that stay API-specific (authorizeUrl / scope / credentialType /
 * testUrl) are still defined here since the worker never needs them.
 */

import { OAUTH_TOKEN_PROVIDERS } from '@flowforge/shared-types';

export interface OAuthProviderConfig {
  /** Credential `type` value stored once the connection is created. */
  credentialType: string;
  displayName: string;
  authorizeUrl: string;
  /** From shared OAUTH_TOKEN_PROVIDERS — single source of truth. */
  tokenUrl: string;
  scope: string;
  /** Extra query params to send to the authorize endpoint. */
  extraAuthorizeParams?: Record<string, string>;
  /** From shared OAUTH_TOKEN_PROVIDERS — single source of truth. */
  clientIdEnv: string;
  /** From shared OAUTH_TOKEN_PROVIDERS — single source of truth. */
  clientSecretEnv: string;
  /** Endpoint used by the "Test connection" button to verify the token still works. */
  testUrl?: string;
}

// Per-provider fields that only the API needs (authorize URL, scopes, etc.),
// merged with the shared token-endpoint fields.
const API_SPECIFIC: Record<string, Omit<OAuthProviderConfig, 'tokenUrl' | 'clientIdEnv' | 'clientSecretEnv'>> = {
  google: {
    credentialType: 'google-oauth2',
    displayName: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/gmail.send email profile',
    extraAuthorizeParams: { access_type: 'offline', prompt: 'consent' },
    testUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
  },
  slack: {
    credentialType: 'slack-oauth2',
    displayName: 'Slack',
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    scope: 'chat:write,channels:read,users:read',
    testUrl: 'https://slack.com/api/auth.test',
  },
  github: {
    credentialType: 'github-oauth2',
    displayName: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    scope: 'repo read:user',
    testUrl: 'https://api.github.com/user',
  },
  microsoft: {
    credentialType: 'microsoft-oauth2',
    displayName: 'Microsoft',
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    scope: 'offline_access User.Read Mail.Send Files.ReadWrite',
    testUrl: 'https://graph.microsoft.com/v1.0/me',
  },
};

// Build the final config by merging API-specific fields with shared token-endpoint fields.
export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = Object.fromEntries(
  Object.entries(API_SPECIFIC).map(([id, apiFields]) => {
    const shared = OAUTH_TOKEN_PROVIDERS[id];
    if (!shared) throw new Error(`oauthProviders: no shared token config for provider "${id}"`);
    return [id, { ...apiFields, ...shared }];
  })
);

export type OAuthProviderId = keyof typeof OAUTH_PROVIDERS;

export function getProviderConfig(provider: string): OAuthProviderConfig {
  const config = OAUTH_PROVIDERS[provider];
  if (!config) {
    throw new Error(`Unknown OAuth provider: ${provider}`);
  }
  return config;
}

export function getRedirectUri(provider: string): string {
  const apiOrigin = process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
  return `${apiOrigin}/credentials/oauth/${provider}/callback`;
}
