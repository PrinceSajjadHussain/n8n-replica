/**
 * oauthRefresh.ts — generic OAuth2 token refresh helper.
 *
 * n8n audit section 16: n8n implements the refresh-token flow ONCE
 * generically (OAuth2Api.credentials.ts base type) and every integration
 * supplies only its specific tokenUrl/scopes. This module is FlowForge's
 * equivalent: one refresh implementation, zero per-integration duplication.
 *
 * Called transparently by getDecryptedCredentialById() in executions.ts
 * so every node that fetches a credential automatically gets a fresh token
 * without knowing anything about OAuth — no call-site changes needed.
 *
 * Strategy:
 *   - Skip non-oauth2 credentials entirely (returns unchanged data).
 *   - Skip providers with no recorded expiry (e.g. GitHub tokens that
 *     don't expire — already recorded as oauthExpiresAt=null in the DB).
 *   - Skip credentials with no stored refresh token (safe fail — lets
 *     the node hit a normal 401 auth error rather than throwing here).
 *   - Refresh 60 seconds before actual expiry (buffer for clock skew
 *     and the network round-trip to the integration's token endpoint).
 *   - Persists the new access token (and rotated refresh token, if the
 *     provider issued one) back to the Credential row.
 */

import { OAUTH_TOKEN_PROVIDERS } from '@flowforge/shared-types';
import { pool } from './pool';
import { encrypt, decrypt } from './crypto';

export interface OAuthCredentialMeta {
  authType: string | null;
  oauthProvider: string | null;
  /** ISO timestamp string, or null if the provider doesn't expire tokens. */
  oauthExpiresAt: string | null;
}

/**
 * If `meta` indicates an oauth2 credential whose token is within 60s of
 * expiry, performs a grant_type=refresh_token exchange and persists the
 * new token back to the DB.
 *
 * Returns `data` unchanged if no refresh was needed or possible.
 * Never throws — on any error it logs and returns the original data,
 * letting the node attempt the call and surface a proper auth error.
 */
export async function refreshOAuthTokenIfNeeded(
  credentialId: string,
  data: Record<string, unknown>,
  meta: OAuthCredentialMeta
): Promise<Record<string, unknown>> {
  // Only act on oauth2 credentials.
  if (meta.authType !== 'oauth2') return data;

  // No expiry recorded → provider doesn't expire tokens (e.g. GitHub
  // personal access tokens), skip refresh.
  if (!meta.oauthExpiresAt) return data;

  const expiresAt = new Date(meta.oauthExpiresAt).getTime();
  const nowMs = Date.now();
  const BUFFER_MS = 60_000;

  // Token is still fresh — no refresh needed.
  if (expiresAt - nowMs > BUFFER_MS) return data;

  // No refresh token stored → can't refresh; let the node fail with a
  // natural auth error rather than crashing the whole execution here.
  const refreshToken = data.refreshToken as string | undefined;
  if (!refreshToken) {
    console.warn(`[oauthRefresh] credential ${credentialId}: token expired but no refreshToken stored — skipping refresh`);
    return data;
  }

  const provider = meta.oauthProvider;
  if (!provider) {
    console.warn(`[oauthRefresh] credential ${credentialId}: authType=oauth2 but no oauthProvider — skipping refresh`);
    return data;
  }

  const providerConfig = OAUTH_TOKEN_PROVIDERS[provider];
  if (!providerConfig) {
    console.warn(`[oauthRefresh] credential ${credentialId}: unknown oauthProvider "${provider}" — skipping refresh`);
    return data;
  }

  const clientId = process.env[providerConfig.clientIdEnv];
  const clientSecret = process.env[providerConfig.clientSecretEnv];
  if (!clientId || !clientSecret) {
    console.warn(`[oauthRefresh] credential ${credentialId}: missing env ${providerConfig.clientIdEnv}/${providerConfig.clientSecretEnv} — skipping refresh`);
    return data;
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const resp = await fetch(providerConfig.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText);
      console.error(`[oauthRefresh] credential ${credentialId}: token refresh failed (${resp.status}): ${errText}`);
      return data; // safe fail
    }

    const json = (await resp.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const newAccessToken = json.access_token;
    // Some providers rotate the refresh token; others reuse the same one.
    const newRefreshToken = json.refresh_token ?? refreshToken;
    const newExpiresAt = json.expires_in
      ? new Date(Date.now() + json.expires_in * 1000).toISOString()
      : null;

    const updatedData: Record<string, unknown> = {
      ...data,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };

    // Persist back to DB so the next execution doesn't need to refresh again
    // until the new token actually expires.
    await pool.query(
      `UPDATE "Credential"
         SET "encryptedData" = $1,
             "oauthExpiresAt" = $2
       WHERE id = $3`,
      [encrypt(JSON.stringify(updatedData)), newExpiresAt, credentialId]
    );

    return updatedData;
  } catch (err) {
    console.error(`[oauthRefresh] credential ${credentialId}: unexpected error during refresh:`, err);
    return data; // safe fail
  }
}
