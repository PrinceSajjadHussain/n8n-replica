/**
 * oauthTokenProviders.ts — single source of truth for OAuth2 token
 * endpoint config shared across apps/api and apps/worker.
 *
 * n8n audit section 16: n8n implements the refresh-token flow ONCE
 * generically, and each integration supplies only its specific URLs/scopes.
 * This file is the "define once" counterpart: tokenUrl / clientIdEnv /
 * clientSecretEnv are defined here and imported by both apps, so neither
 * can independently drift to a different token endpoint.
 *
 * apps/api/src/config/oauthProviders.ts spreads these into its richer
 * per-app config (authorizeUrl / scope / testUrl stay API-specific).
 * apps/worker/src/db/oauthRefresh.ts uses these to do the actual
 * grant_type=refresh_token call before handing a credential to a node.
 */

export interface OAuthTokenProvider {
  /** The token endpoint used for both initial exchange and refresh. */
  tokenUrl: string;
  /** process.env key for the OAuth client ID. */
  clientIdEnv: string;
  /** process.env key for the OAuth client secret. */
  clientSecretEnv: string;
}

/**
 * Provider id → token-endpoint config.
 * Keys are the `oauthProvider` value stored on a Credential row when the
 * OAuth callback completes (set by apps/api/src/routes/credentials.ts).
 */
export const OAUTH_TOKEN_PROVIDERS: Record<string, OAuthTokenProvider> = {
  google: {
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
  },
  slack: {
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    clientIdEnv: 'SLACK_OAUTH_CLIENT_ID',
    clientSecretEnv: 'SLACK_OAUTH_CLIENT_SECRET',
  },
  github: {
    // GitHub tokens don't expire by default; an entry is included here so
    // the refresh helper can detect "unknown provider" vs "known but no expiry"
    // — it will skip the refresh (no oauthExpiresAt) but won't error.
    tokenUrl: 'https://github.com/login/oauth/access_token',
    clientIdEnv: 'GITHUB_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GITHUB_OAUTH_CLIENT_SECRET',
  },
  microsoft: {
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    clientIdEnv: 'MICROSOFT_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_OAUTH_CLIENT_SECRET',
  },
};
