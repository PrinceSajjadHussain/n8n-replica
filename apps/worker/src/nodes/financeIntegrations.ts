import axios from 'axios';
import { registerNode } from './types';
import type { NodePlugin } from './types';
import { wrapIntegrationError } from './integrationErrors';

/**
 * paypal — alternative payment processor to the existing Stripe node.
 * Uses PayPal's REST API (v2 orders / v1 payouts) with the standard
 * client-credentials OAuth2 flow, done inline here (short-lived token,
 * not persisted) rather than through the shared oauthProviders config,
 * matching how mongodb/mysql/zoom etc. take raw credential fields instead
 * of a registered OAuth app.
 * credential (type 'paypal'): { clientId: string, clientSecret: string, mode?: 'sandbox' | 'live' }
 * params:
 *   action: 'createOrder' | 'captureOrder' | 'getOrder' | 'createPayout'
 *   amount?, currency? (createOrder — currency defaults to 'USD')
 *   orderId? (captureOrder, getOrder)
 *   payout? (createPayout — PayPal payout batch body)
 */
export const paypalNode: NodePlugin = {
  type: 'paypal',
  async execute({ params, credential }) {
    const clientId = credential?.clientId as string;
    const clientSecret = credential?.clientSecret as string;
    if (!clientId || !clientSecret) {
      throw new Error('paypal node: requires a "paypal" credential with { "clientId", "clientSecret" }');
    }
    const mode = (credential?.mode as string) === 'live' ? 'live' : 'sandbox';
    const base = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    const action = String(params.action ?? 'createOrder');
    try {
      const tokenRes = await axios.post(
        `${base}/v1/oauth2/token`,
        'grant_type=client_credentials',
        {
          auth: { username: clientId, password: clientSecret },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 15000,
        }
      );
      const accessToken = tokenRes.data.access_token as string;
      const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

      if (action === 'createOrder') {
        const response = await axios.post(
          `${base}/v2/checkout/orders`,
          {
            intent: 'CAPTURE',
            purchase_units: [
              { amount: { currency_code: (params.currency as string) ?? 'USD', value: String(params.amount ?? '0.00') } },
            ],
          },
          { headers, timeout: 15000 }
        );
        return { output: response.data };
      }
      if (action === 'captureOrder') {
        if (!params.orderId) throw new Error('paypal node: "captureOrder" requires "orderId"');
        const response = await axios.post(`${base}/v2/checkout/orders/${params.orderId}/capture`, {}, { headers, timeout: 15000 });
        return { output: response.data };
      }
      if (action === 'getOrder') {
        if (!params.orderId) throw new Error('paypal node: "getOrder" requires "orderId"');
        const response = await axios.get(`${base}/v2/checkout/orders/${params.orderId}`, { headers, timeout: 15000 });
        return { output: response.data };
      }
      if (action === 'createPayout') {
        const response = await axios.post(`${base}/v1/payments/payouts`, params.payout ?? {}, { headers, timeout: 15000 });
        return { output: response.data };
      }
      throw new Error(`paypal node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('paypal', err);
    }
  },
};

/**
 * quickbooks — QuickBooks Online accounting sync (invoicing, customers).
 * credential (type 'quickbooks'): { accessToken: string, realmId: string, environment?: 'sandbox' | 'production' }
 *   (accessToken is short-lived — a 401 here means "reconnect QuickBooks",
 *   same convention as the other pasted-OAuth-token credentials.)
 * params:
 *   action: 'createInvoice' | 'listInvoices' | 'createCustomer' | 'getCompanyInfo'
 *   invoice? (createInvoice — QBO Invoice resource body)
 *   customer? (createCustomer — QBO Customer resource body)
 */
export const quickbooksNode: NodePlugin = {
  type: 'quickbooks',
  async execute({ params, credential }) {
    const accessToken = credential?.accessToken as string;
    const realmId = credential?.realmId as string;
    if (!accessToken || !realmId) {
      throw new Error('quickbooks node: requires a "quickbooks" credential with { "accessToken", "realmId" }');
    }
    const environment = (credential?.environment as string) === 'production' ? 'production' : 'sandbox';
    const base =
      environment === 'production'
        ? `https://quickbooks.api.intuit.com/v3/company/${realmId}`
        : `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}`;
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' };
    const action = String(params.action ?? 'listInvoices');
    try {
      if (action === 'createInvoice') {
        const response = await axios.post(`${base}/invoice`, params.invoice ?? {}, { headers, timeout: 15000 });
        return { output: response.data };
      }
      if (action === 'listInvoices') {
        const response = await axios.get(`${base}/query`, {
          headers,
          params: { query: (params.query as string) ?? 'select * from Invoice maxresults 25' },
          timeout: 15000,
        });
        return { output: response.data };
      }
      if (action === 'createCustomer') {
        const response = await axios.post(`${base}/customer`, params.customer ?? {}, { headers, timeout: 15000 });
        return { output: response.data };
      }
      if (action === 'getCompanyInfo') {
        const response = await axios.get(`${base}/companyinfo/${realmId}`, { headers, timeout: 15000 });
        return { output: response.data };
      }
      throw new Error(`quickbooks node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('quickbooks', err);
    }
  },
};

/**
 * xero — Xero accounting sync, parallel to the QuickBooks node above for
 * teams on Xero instead of (or in addition to) QBO.
 * credential (type 'xero'): { accessToken: string, tenantId: string }
 * params:
 *   action: 'createInvoice' | 'listInvoices' | 'createContact'
 *   invoice? (createInvoice — Xero Invoice resource body)
 *   contact? (createContact — Xero Contact resource body)
 */
export const xeroNode: NodePlugin = {
  type: 'xero',
  async execute({ params, credential }) {
    const accessToken = credential?.accessToken as string;
    const tenantId = credential?.tenantId as string;
    if (!accessToken || !tenantId) {
      throw new Error('xero node: requires a "xero" credential with { "accessToken", "tenantId" }');
    }
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Xero-tenant-id': tenantId,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    const base = 'https://api.xero.com/api.xro/2.0';
    const action = String(params.action ?? 'listInvoices');
    try {
      if (action === 'createInvoice') {
        const response = await axios.post(`${base}/Invoices`, params.invoice ?? {}, { headers, timeout: 15000 });
        return { output: response.data };
      }
      if (action === 'listInvoices') {
        const response = await axios.get(`${base}/Invoices`, { headers, timeout: 15000 });
        return { output: response.data };
      }
      if (action === 'createContact') {
        const response = await axios.post(`${base}/Contacts`, params.contact ?? {}, { headers, timeout: 15000 });
        return { output: response.data };
      }
      throw new Error(`xero node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('xero', err);
    }
  },
};

/**
 * zendesk — support ticket create/update/lookup. Previously only listed as
 * an illustrative "flowforge-node-zendesk" community-marketplace entry
 * (npm package that doesn't actually exist) — this is the real
 * first-class implementation; see the marketplace curation cleanup in
 * registryIndex.ts.
 * credential (type 'zendesk'): { subdomain: string, email: string, apiToken: string }
 *   (basic-auth as "email/token" + apiToken, per Zendesk's API token scheme)
 * params:
 *   action: 'createTicket' | 'updateTicket' | 'getTicket' | 'listTickets'
 *   subject?, body?, priority?, requesterEmail? (createTicket)
 *   ticketId? (updateTicket, getTicket)
 *   updates? (updateTicket — partial Zendesk ticket body)
 */
export const zendeskNode: NodePlugin = {
  type: 'zendesk',
  async execute({ params, credential }) {
    const subdomain = credential?.subdomain as string;
    const email = credential?.email as string;
    const apiToken = credential?.apiToken as string;
    if (!subdomain || !email || !apiToken) {
      throw new Error('zendesk node: requires a "zendesk" credential with { "subdomain", "email", "apiToken" }');
    }
    const auth = { username: `${email}/token`, password: apiToken };
    const base = `https://${subdomain}.zendesk.com/api/v2`;
    const action = String(params.action ?? 'createTicket');
    try {
      if (action === 'createTicket') {
        const response = await axios.post(
          `${base}/tickets.json`,
          {
            ticket: {
              subject: params.subject,
              comment: { body: String(params.body ?? '') },
              priority: params.priority ?? 'normal',
              requester: params.requesterEmail ? { email: params.requesterEmail } : undefined,
            },
          },
          { auth, timeout: 15000 }
        );
        return { output: response.data };
      }
      if (action === 'updateTicket') {
        if (!params.ticketId) throw new Error('zendesk node: "updateTicket" requires "ticketId"');
        const response = await axios.put(
          `${base}/tickets/${params.ticketId}.json`,
          { ticket: params.updates ?? {} },
          { auth, timeout: 15000 }
        );
        return { output: response.data };
      }
      if (action === 'getTicket') {
        if (!params.ticketId) throw new Error('zendesk node: "getTicket" requires "ticketId"');
        const response = await axios.get(`${base}/tickets/${params.ticketId}.json`, { auth, timeout: 15000 });
        return { output: response.data };
      }
      if (action === 'listTickets') {
        const response = await axios.get(`${base}/tickets.json`, { auth, timeout: 15000 });
        return { output: response.data };
      }
      throw new Error(`zendesk node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('zendesk', err);
    }
  },
};

registerNode(paypalNode);
registerNode(quickbooksNode);
registerNode(xeroNode);
registerNode(zendeskNode);
