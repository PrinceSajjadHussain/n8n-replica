export interface OAuthProviderConfig {
  /** Credential `type` value stored once the connection is created. */
  credentialType: string;
  displayName: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  /** Extra query params to send to the authorize endpoint. */
  extraAuthorizeParams?: Record<string, string>;
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Endpoint used by the "Test connection" button to verify the token still works. */
  testUrl?: string;
}

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  google: {
    credentialType: 'google-oauth2',
    displayName: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/gmail.send email profile',
    extraAuthorizeParams: { access_type: 'offline', prompt: 'consent' },
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    testUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
  },
  slack: {
    credentialType: 'slack-oauth2',
    displayName: 'Slack',
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scope: 'chat:write,channels:read,users:read',
    clientIdEnv: 'SLACK_OAUTH_CLIENT_ID',
    clientSecretEnv: 'SLACK_OAUTH_CLIENT_SECRET',
    testUrl: 'https://slack.com/api/auth.test',
  },
  github: {
    credentialType: 'github-oauth2',
    displayName: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'repo read:user',
    clientIdEnv: 'GITHUB_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GITHUB_OAUTH_CLIENT_SECRET',
    testUrl: 'https://api.github.com/user',
  },
};

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
