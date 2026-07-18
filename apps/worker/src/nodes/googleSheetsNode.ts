import axios from 'axios';
import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * Google Sheets node — real reads/appends via the Sheets v4 REST API,
 * authenticated with the accessToken captured by the "Connect with Google"
 * OAuth flow (credential type 'google-oauth2', already requests the
 * spreadsheets scope — see apps/api/src/config/oauthProviders.ts).
 *
 * credential: { accessToken: string, refreshToken?: string }
 *   (accessToken is short-lived; if it has expired, this node fails with a
 *   clear "reconnect Google" error rather than a cryptic 401 — full
 *   auto-refresh needs the OAuth client secret, which only the API process
 *   holds, so for now the fix is: Credentials page -> Connect with Google
 *   again.)
 *
 * params:
 *   operation: 'append' | 'get'   (default 'append')
 *   spreadsheetId: string          (required)
 *   range: string                  (e.g. "Sheet1!A:C", required)
 *   values: unknown[][]            (append only — explicit rows; if omitted,
 *                                    each input item's json values are used
 *                                    as one row, in insertion-order of keys)
 */
export const googleSheetsNode: NodePlugin = {
  type: 'googleSheets',
  async execute({ items, params, credential }) {
    const accessToken = credential?.accessToken as string | undefined;
    if (!accessToken) {
      throw new Error(
        'googleSheets node: no Google credential attached — go to Credentials → Connect with Google, then select that credential on this node.'
      );
    }

    const spreadsheetId = String(params.spreadsheetId ?? '');
    const range = String(params.range ?? '');
    const operation = (params.operation as string | undefined) ?? 'append';
    if (!spreadsheetId) throw new Error('googleSheets node: params.spreadsheetId is required');
    if (!range) throw new Error('googleSheets node: params.range is required');

    const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
      range
    )}`;
    const headers = { Authorization: `Bearer ${accessToken}` };

    if (operation === 'get') {
      const response = await axios.get(base, { headers, validateStatus: () => true, timeout: 15_000 });
      assertOk(response, 'read');
      const rows: unknown[][] = response.data?.values ?? [];
      return { items: rows.map((row, i) => ({ json: { row }, pairedItem: { item: i } })) };
    }

    // append
    const explicitValues = params.values as unknown[][] | undefined;
    const rows = explicitValues ?? items.map((item) => Object.values(item.json));
    if (rows.length === 0) {
      return { items: [{ json: { appended: 0 } }] };
    }

    const response = await axios.post(
      `${base}:append`,
      { values: rows },
      {
        headers,
        params: { valueInputOption: 'USER_ENTERED' },
        validateStatus: () => true,
        timeout: 15_000,
      }
    );
    assertOk(response, 'append');

    return {
      items: [
        {
          json: {
            appended: rows.length,
            updatedRange: response.data?.updates?.updatedRange ?? null,
          },
        },
      ],
    };
  },
};

function assertOk(response: { status: number; data?: any }, action: 'read' | 'append'): void {
  if (response.status === 401) {
    throw new Error(
      'googleSheets node: Google access token expired or invalid — reconnect via Credentials → Connect with Google.'
    );
  }
  if (response.status >= 300) {
    throw new Error(
      `googleSheets node: ${action} failed with status ${response.status}: ${JSON.stringify(response.data)}`
    );
  }
}

registerNode(googleSheetsNode);
