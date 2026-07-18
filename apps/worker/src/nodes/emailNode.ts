import axios from 'axios';
import { registerNode, normalizeToItems } from './types';
import type { NodePlugin } from './types';

/**
 * Email node — sends a real email via Resend or SendGrid's HTTP API.
 *
 * credential (type 'email'), any of:
 *   { "provider": "resend",   "apiKey": "re_...",  "from": "alerts@yourdomain.com" }
 *   { "provider": "sendgrid", "apiKey": "SG...",   "from": "alerts@yourdomain.com" }
 * If no credential is attached, falls back to the server-wide
 * RESEND_API_KEY / SENDGRID_API_KEY / ALERTS_FROM_EMAIL env vars (the same
 * ones used by the execution-failure alert system), so a workflow author
 * doesn't have to duplicate a credential the admin already configured.
 *
 * params (per item, expressions already resolved by the executor):
 *   { "to": "user@example.com", "subject": "...", "body": "...", "html": false }
 */
export const emailNode: NodePlugin = {
  type: 'email',
  async execute({ items, params, credential }) {
    const provider = (credential?.provider as string | undefined) ?? inferProvider();
    const apiKey =
      (credential?.apiKey as string | undefined) ??
      (provider === 'sendgrid' ? process.env.SENDGRID_API_KEY : process.env.RESEND_API_KEY);
    const from = (credential?.from as string | undefined) ?? process.env.ALERTS_FROM_EMAIL ?? 'alerts@flowforge.dev';

    if (!apiKey) {
      throw new Error(
        'email node: no API key available — attach an "email" credential ({"provider":"resend"|"sendgrid","apiKey":"...","from":"..."}) or set RESEND_API_KEY / SENDGRID_API_KEY on the server.'
      );
    }

    const inputItems = items.length > 0 ? items : normalizeToItems(null);
    const to = String(params.to ?? '');
    const subject = String(params.subject ?? '');
    const body = String(params.body ?? '');
    const isHtml = Boolean(params.html);

    if (!to) throw new Error('email node: params.to is required');
    if (!subject) throw new Error('email node: params.subject is required');

    const outItems = await Promise.all(
      inputItems.map(async (item, i) => {
        const result =
          provider === 'sendgrid'
            ? await sendViaSendGrid({ apiKey, from, to, subject, body, isHtml })
            : await sendViaResend({ apiKey, from, to, subject, body, isHtml });
        return { json: { sent: true, provider, to, subject, ...result }, pairedItem: { item: i } };
      })
    );

    return { items: outItems };
  },
};

function inferProvider(): 'resend' | 'sendgrid' {
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SENDGRID_API_KEY) return 'sendgrid';
  return 'resend';
}

async function sendViaResend(opts: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  isHtml: boolean;
}): Promise<{ status: number; providerId?: string }> {
  const { apiKey, from, to, subject, body, isHtml } = opts;
  const response = await axios.post(
    'https://api.resend.com/emails',
    {
      from,
      to,
      subject,
      ...(isHtml ? { html: body } : { text: body }),
    },
    { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10_000, validateStatus: () => true }
  );
  if (response.status >= 300) {
    throw new Error(`email node: Resend API returned ${response.status}: ${JSON.stringify(response.data)}`);
  }
  return { status: response.status, providerId: response.data?.id };
}

async function sendViaSendGrid(opts: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  isHtml: boolean;
}): Promise<{ status: number }> {
  const { apiKey, from, to, subject, body, isHtml } = opts;
  const response = await axios.post(
    'https://api.sendgrid.com/v3/mail/send',
    {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from },
      subject,
      content: [{ type: isHtml ? 'text/html' : 'text/plain', value: body }],
    },
    { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10_000, validateStatus: () => true }
  );
  if (response.status >= 300) {
    throw new Error(`email node: SendGrid API returned ${response.status}: ${JSON.stringify(response.data)}`);
  }
  return { status: response.status };
}

registerNode(emailNode);
