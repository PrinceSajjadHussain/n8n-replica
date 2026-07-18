import axios from 'axios';
import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * stripe — thin wrapper over the Stripe REST API (form-encoded, as Stripe expects).
 * credential (type 'stripe'): { secretKey: string }
 * params:
 *   action: 'createCustomer' | 'createCharge' | 'createPaymentIntent' | 'createInvoice' |
 *           'getCustomer' | 'listCharges' | 'createRefund' | 'createSubscription'
 *   ...fields specific to the action, passed straight through as form fields
 */
function toForm(obj: Record<string, unknown>): string {
  const params = new URLSearchParams();
  const walk = (prefix: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(`${prefix}[${k}]`, v);
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${prefix}[${i}]`, v));
    } else {
      params.append(prefix, String(value));
    }
  };
  for (const [k, v] of Object.entries(obj)) walk(k, v);
  return params.toString();
}

const STRIPE_ENDPOINTS: Record<string, { method: 'get' | 'post'; path: (p: Record<string, unknown>) => string }> = {
  createCustomer: { method: 'post', path: () => '/customers' },
  getCustomer: { method: 'get', path: (p) => `/customers/${p.customerId}` },
  createCharge: { method: 'post', path: () => '/charges' },
  listCharges: { method: 'get', path: () => '/charges' },
  createPaymentIntent: { method: 'post', path: () => '/payment_intents' },
  createRefund: { method: 'post', path: () => '/refunds' },
  createInvoice: { method: 'post', path: () => '/invoices' },
  createSubscription: { method: 'post', path: () => '/subscriptions' },
};

export const stripeNode: NodePlugin = {
  type: 'stripe',
  async execute({ params, credential }) {
    const secretKey = credential?.secretKey as string;
    if (!secretKey) throw new Error('stripe node: requires a "stripe" credential with { "secretKey": "sk_..." }');
    const action = String(params.action ?? 'createCustomer');
    const spec = STRIPE_ENDPOINTS[action];
    if (!spec) throw new Error(`stripe node: unknown action "${action}"`);
    const url = `https://api.stripe.com/v1${spec.path(params)}`;
    const headers = { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' };
    const { action: _a, customerId: _c, ...fields } = params;
    const response =
      spec.method === 'get'
        ? await axios.get(url, { headers, params: fields, timeout: 15000 })
        : await axios.post(url, toForm(fields), { headers, timeout: 15000 });
    return { output: response.data };
  },
};

/**
 * twilio — send SMS/WhatsApp messages or make calls via the Twilio REST API.
 * credential (type 'twilio'): { accountSid: string, authToken: string }
 * params: { action: 'sendSms'|'sendWhatsapp'|'makeCall', to, from, body?, url? }
 */
export const twilioNode: NodePlugin = {
  type: 'twilio',
  async execute({ params, credential }) {
    const accountSid = credential?.accountSid as string;
    const authToken = credential?.authToken as string;
    if (!accountSid || !authToken)
      throw new Error('twilio node: requires a "twilio" credential with { "accountSid", "authToken" }');
    const action = String(params.action ?? 'sendSms');
    const auth = { username: accountSid, password: authToken };

    if (action === 'sendSms' || action === 'sendWhatsapp') {
      const to = action === 'sendWhatsapp' ? `whatsapp:${params.to}` : String(params.to);
      const from = action === 'sendWhatsapp' ? `whatsapp:${params.from}` : String(params.from);
      const response = await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        new URLSearchParams({ To: to, From: from, Body: String(params.body ?? '') }),
        { auth, timeout: 15000 }
      );
      return { output: response.data };
    }
    if (action === 'makeCall') {
      const response = await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
        new URLSearchParams({ To: String(params.to), From: String(params.from), Url: String(params.url ?? '') }),
        { auth, timeout: 15000 }
      );
      return { output: response.data };
    }
    throw new Error(`twilio node: unknown action "${action}"`);
  },
};

/**
 * whatsapp — sends via the Meta WhatsApp Cloud API directly (no Twilio).
 * credential (type 'whatsapp'): { accessToken: string, phoneNumberId: string }
 * params: { to: string, type: 'text'|'template', text?: string, templateName?: string, templateLang?: string, templateParams?: string[] }
 */
export const whatsappNode: NodePlugin = {
  type: 'whatsapp',
  async execute({ params, credential }) {
    const accessToken = credential?.accessToken as string;
    const phoneNumberId = credential?.phoneNumberId as string;
    if (!accessToken || !phoneNumberId)
      throw new Error('whatsapp node: requires a "whatsapp" credential with { "accessToken", "phoneNumberId" }');
    const type = String(params.type ?? 'text');
    const body: Record<string, unknown> =
      type === 'template'
        ? {
            messaging_product: 'whatsapp',
            to: params.to,
            type: 'template',
            template: {
              name: params.templateName,
              language: { code: params.templateLang ?? 'en_US' },
              components: params.templateParams
                ? [{ type: 'body', parameters: (params.templateParams as string[]).map((t) => ({ type: 'text', text: t })) }]
                : [],
            },
          }
        : { messaging_product: 'whatsapp', to: params.to, type: 'text', text: { body: String(params.text ?? '') } };

    const response = await axios.post(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, body, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    return { output: response.data };
  },
};

/**
 * hubspot — CRM operations against the HubSpot API.
 * credential (type 'hubspot'): { accessToken: string }  (private app or OAuth token)
 * params: { action: 'createContact'|'updateContact'|'getContact'|'createDeal'|'searchContacts', ...fields }
 */
export const hubspotNode: NodePlugin = {
  type: 'hubspot',
  async execute({ params, credential }) {
    const accessToken = credential?.accessToken as string;
    if (!accessToken) throw new Error('hubspot node: requires a "hubspot" credential with { "accessToken": "..." }');
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
    const action = String(params.action ?? 'createContact');
    const base = 'https://api.hubapi.com';

    if (action === 'createContact') {
      const response = await axios.post(`${base}/crm/v3/objects/contacts`, { properties: params.properties ?? {} }, { headers, timeout: 15000 });
      return { output: response.data };
    }
    if (action === 'updateContact') {
      const response = await axios.patch(
        `${base}/crm/v3/objects/contacts/${params.contactId}`,
        { properties: params.properties ?? {} },
        { headers, timeout: 15000 }
      );
      return { output: response.data };
    }
    if (action === 'getContact') {
      const response = await axios.get(`${base}/crm/v3/objects/contacts/${params.contactId}`, { headers, timeout: 15000 });
      return { output: response.data };
    }
    if (action === 'searchContacts') {
      const response = await axios.post(`${base}/crm/v3/objects/contacts/search`, params.query ?? {}, { headers, timeout: 15000 });
      return { output: response.data };
    }
    if (action === 'createDeal') {
      const response = await axios.post(`${base}/crm/v3/objects/deals`, { properties: params.properties ?? {} }, { headers, timeout: 15000 });
      return { output: response.data };
    }
    throw new Error(`hubspot node: unknown action "${action}"`);
  },
};

/**
 * salesforce — REST API wrapper (requires a pre-obtained OAuth access token + instance URL;
 * pair this node with an OAuth2 credential flow configured in oauthProviders.ts).
 * credential (type 'salesforce'): { accessToken: string, instanceUrl: string }
 * params: { action: 'createRecord'|'updateRecord'|'getRecord'|'query', sobject?: string, recordId?: string, fields?: object, soql?: string }
 */
export const salesforceNode: NodePlugin = {
  type: 'salesforce',
  async execute({ params, credential }) {
    const accessToken = credential?.accessToken as string;
    const instanceUrl = credential?.instanceUrl as string;
    if (!accessToken || !instanceUrl)
      throw new Error('salesforce node: requires a "salesforce" credential with { "accessToken", "instanceUrl" }');
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
    const action = String(params.action ?? 'query');
    const sobject = params.sobject as string;

    if (action === 'query') {
      const response = await axios.get(`${instanceUrl}/services/data/v60.0/query`, {
        headers,
        params: { q: params.soql },
        timeout: 15000,
      });
      return { output: response.data };
    }
    if (action === 'createRecord') {
      const response = await axios.post(`${instanceUrl}/services/data/v60.0/sobjects/${sobject}`, params.fields ?? {}, { headers, timeout: 15000 });
      return { output: response.data };
    }
    if (action === 'updateRecord') {
      await axios.patch(`${instanceUrl}/services/data/v60.0/sobjects/${sobject}/${params.recordId}`, params.fields ?? {}, { headers, timeout: 15000 });
      return { output: { updated: true, id: params.recordId } };
    }
    if (action === 'getRecord') {
      const response = await axios.get(`${instanceUrl}/services/data/v60.0/sobjects/${sobject}/${params.recordId}`, { headers, timeout: 15000 });
      return { output: response.data };
    }
    throw new Error(`salesforce node: unknown action "${action}"`);
  },
};

/**
 * shopify — Admin REST API wrapper.
 * credential (type 'shopify'): { shopDomain: string (e.g. "my-store.myshopify.com"), accessToken: string }
 * params: { action: 'listProducts'|'createProduct'|'getOrder'|'listOrders'|'createOrder'|'updateInventory', ...fields }
 */
export const shopifyNode: NodePlugin = {
  type: 'shopify',
  async execute({ params, credential }) {
    const shopDomain = credential?.shopDomain as string;
    const accessToken = credential?.accessToken as string;
    if (!shopDomain || !accessToken)
      throw new Error('shopify node: requires a "shopify" credential with { "shopDomain", "accessToken" }');
    const headers = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' };
    const base = `https://${shopDomain}/admin/api/2024-07`;
    const action = String(params.action ?? 'listProducts');

    if (action === 'listProducts') {
      const response = await axios.get(`${base}/products.json`, { headers, params: { limit: params.limit ?? 50 }, timeout: 15000 });
      return { output: response.data };
    }
    if (action === 'createProduct') {
      const response = await axios.post(`${base}/products.json`, { product: params.product ?? {} }, { headers, timeout: 15000 });
      return { output: response.data };
    }
    if (action === 'listOrders') {
      const response = await axios.get(`${base}/orders.json`, { headers, params: { status: params.status ?? 'any' }, timeout: 15000 });
      return { output: response.data };
    }
    if (action === 'getOrder') {
      const response = await axios.get(`${base}/orders/${params.orderId}.json`, { headers, timeout: 15000 });
      return { output: response.data };
    }
    if (action === 'createOrder') {
      const response = await axios.post(`${base}/orders.json`, { order: params.order ?? {} }, { headers, timeout: 15000 });
      return { output: response.data };
    }
    if (action === 'updateInventory') {
      const response = await axios.post(
        `${base}/inventory_levels/set.json`,
        { location_id: params.locationId, inventory_item_id: params.inventoryItemId, available: params.available },
        { headers, timeout: 15000 }
      );
      return { output: response.data };
    }
    throw new Error(`shopify node: unknown action "${action}"`);
  },
};

registerNode(stripeNode);
registerNode(twilioNode);
registerNode(whatsappNode);
registerNode(hubspotNode);
registerNode(salesforceNode);
registerNode(shopifyNode);
