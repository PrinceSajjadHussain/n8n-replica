import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * STUB NODES — clear extension pattern for integrations not yet fully
 * implemented. Each stub validates its params/credential shape and throws a
 * descriptive "not implemented" error rather than silently no-op'ing, so a
 * workflow author gets clear feedback instead of a false "success".
 *
 * To turn a stub into a real integration: replace the throw with a real
 * API call (see slackNode.ts or httpRequestNode.ts for the pattern), keep
 * the same `type` string so existing workflow JSON keeps working.
 */

export const emailNode: NodePlugin = {
  type: 'email',
  async execute({ params }) {
    // Extension point: wire up nodemailer / SendGrid / SES here using
    // `credential` for SMTP/API auth and `params.to/subject/body`.
    throw new Error(
      `email node is a stub — configure an SMTP or SendGrid credential and implement send logic in emailNode.ts (params received: ${JSON.stringify(
        params
      )})`
    );
  },
};

export const googleSheetsNode: NodePlugin = {
  type: 'googleSheets',
  async execute({ params }) {
    // Extension point: wire up googleapis (sheets v4) here using an OAuth
    // credential and `params.spreadsheetId/range/values`.
    throw new Error(
      `googleSheets node is a stub — configure a Google OAuth credential and implement sheets.spreadsheets.values.append/get in googleSheetsNode.ts (params received: ${JSON.stringify(
        params
      )})`
    );
  },
};

registerNode(emailNode);
registerNode(googleSheetsNode);
