import axios from 'axios';
import { registerNode } from './types';
import type { NodePlugin } from './types';
import { wrapIntegrationError } from './integrationErrors';

/**
 * mailchimp — audience/member/campaign management. "MAILCHIMP_BASE_URL"
 * has been a seeded default Variable since early on with no node behind
 * it; this is that node. Previously also listed as an illustrative
 * "flowforge-node-mailchimp" community package — see the marketplace
 * cleanup in registryIndex.ts.
 * credential (type 'mailchimp'): { apiKey: string }
 *   (Mailchimp API keys embed the datacenter, e.g. "abc123-us21" — the
 *   node parses the "-usXX" suffix to build the API host, so no separate
 *   "server prefix" field is needed.)
 * params:
 *   action: 'addMember' | 'listMembers' | 'createCampaign'
 *   listId?, email?, mergeFields? (addMember)
 *   campaign? (createCampaign — Mailchimp campaign body)
 */
export const mailchimpNode: NodePlugin = {
  type: 'mailchimp',
  async execute({ params, credential }) {
    const apiKey = credential?.apiKey as string;
    if (!apiKey) throw new Error('mailchimp node: requires a "mailchimp" credential with { "apiKey" }');
    const dc = apiKey.split('-').pop();
    if (!dc) throw new Error('mailchimp node: API key is missing the "-usXX" datacenter suffix.');
    const base = `https://${dc}.api.mailchimp.com/3.0`;
    const auth = { username: 'anystring', password: apiKey };
    const action = String(params.action ?? 'addMember');
    try {
      if (action === 'addMember') {
        if (!params.listId || !params.email) throw new Error('mailchimp node: "addMember" requires "listId" and "email"');
        const response = await axios.post(
          `${base}/lists/${params.listId}/members`,
          { email_address: params.email, status: 'subscribed', merge_fields: params.mergeFields ?? {} },
          { auth, timeout: 15000 }
        );
        return { output: response.data };
      }
      if (action === 'listMembers') {
        if (!params.listId) throw new Error('mailchimp node: "listMembers" requires "listId"');
        const response = await axios.get(`${base}/lists/${params.listId}/members`, { auth, timeout: 15000 });
        return { output: response.data };
      }
      if (action === 'createCampaign') {
        const response = await axios.post(`${base}/campaigns`, params.campaign ?? {}, { auth, timeout: 15000 });
        return { output: response.data };
      }
      throw new Error(`mailchimp node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('mailchimp', err);
    }
  },
};

/**
 * sendgrid — transactional email send, parallel to the IMAP-based email
 * node for outbound-only marketing/transactional mail via API instead of
 * SMTP. Also fills the "SENDGRID" seeded default-Variable gap.
 * credential (type 'sendgrid'): { apiKey: string }
 * params: { to: string, from: string, subject: string, text?: string, html?: string }
 */
export const sendgridNode: NodePlugin = {
  type: 'sendgrid',
  async execute({ params, credential }) {
    const apiKey = credential?.apiKey as string;
    if (!apiKey) throw new Error('sendgrid node: requires a "sendgrid" credential with { "apiKey" }');
    if (!params.to || !params.from || !params.subject) {
      throw new Error('sendgrid node: requires "to", "from", and "subject" params');
    }
    try {
      const response = await axios.post(
        'https://api.sendgrid.com/v3/mail/send',
        {
          personalizations: [{ to: [{ email: params.to }] }],
          from: { email: params.from },
          subject: params.subject,
          content: [
            params.html
              ? { type: 'text/html', value: String(params.html) }
              : { type: 'text/plain', value: String(params.text ?? '') },
          ],
        },
        { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15000 }
      );
      return { output: { status: response.status, messageId: response.headers['x-message-id'] ?? null } };
    } catch (err) {
      throw wrapIntegrationError('sendgrid', err);
    }
  },
};

/**
 * segment — event tracking (track/identify/page/group calls) into
 * Segment's HTTP Tracking API, fanning out to whatever destinations the
 * workspace has connected.
 * credential (type 'segment'): { writeKey: string }
 * params:
 *   action: 'track' | 'identify' | 'page' | 'group' (default 'track')
 *   userId? or anonymousId? (required by Segment for every call type)
 *   event? (track — event name)
 *   name? (page)
 *   groupId? (group)
 *   properties?, traits?
 */
export const segmentNode: NodePlugin = {
  type: 'segment',
  async execute({ params, credential }) {
    const writeKey = credential?.writeKey as string;
    if (!writeKey) throw new Error('segment node: requires a "segment" credential with { "writeKey" }');
    if (!params.userId && !params.anonymousId) {
      throw new Error('segment node: requires "userId" or "anonymousId"');
    }
    const action = String(params.action ?? 'track');
    const endpointByAction: Record<string, string> = { track: 'track', identify: 'identify', page: 'page', group: 'group' };
    const endpoint = endpointByAction[action];
    if (!endpoint) throw new Error(`segment node: unknown action "${action}"`);
    const auth = { username: writeKey, password: '' };
    const body: Record<string, unknown> = {
      userId: params.userId,
      anonymousId: params.anonymousId,
      timestamp: new Date().toISOString(),
    };
    if (action === 'track') body.event = params.event;
    if (action === 'page') body.name = params.name;
    if (action === 'group') body.groupId = params.groupId;
    if (action === 'identify') body.traits = params.traits ?? {};
    else body.properties = params.properties ?? {};
    try {
      const response = await axios.post(`https://api.segment.io/v1/${endpoint}`, body, { auth, timeout: 15000 });
      return { output: { status: response.status } };
    } catch (err) {
      throw wrapIntegrationError('segment', err);
    }
  },
};

/**
 * googleAds — campaign metrics pull via the Google Ads API (Google Ads
 * Query Language / GAQL search). Read-focused, matching the "campaign
 * metrics pull" scope from the remaining-features doc rather than full
 * campaign CRUD.
 * credential (type 'googleAds'): { accessToken: string, developerToken: string, customerId: string, loginCustomerId?: string }
 *   (customerId is the Ads account being queried, digits only, no dashes)
 * params: { query?: string } — a full GAQL query; if omitted, a default
 *   campaign-performance query for the last 7 days is used.
 */
export const googleAdsNode: NodePlugin = {
  type: 'googleAds',
  async execute({ params, credential }) {
    const accessToken = credential?.accessToken as string;
    const developerToken = credential?.developerToken as string;
    const customerId = credential?.customerId as string;
    if (!accessToken || !developerToken || !customerId) {
      throw new Error('googleAds node: requires a "googleAds" credential with { "accessToken", "developerToken", "customerId" }');
    }
    const gaql =
      (params.query as string) ??
      `SELECT campaign.id, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros
       FROM campaign WHERE segments.date DURING LAST_7_DAYS`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': developerToken,
      'Content-Type': 'application/json',
    };
    if (credential?.loginCustomerId) headers['login-customer-id'] = credential.loginCustomerId as string;
    try {
      const response = await axios.post(
        `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:search`,
        { query: gaql },
        { headers, timeout: 20000 }
      );
      return { output: response.data };
    } catch (err) {
      throw wrapIntegrationError('googleAds', err);
    }
  },
};

/**
 * metaAds — campaign metrics pull from the Meta Marketing API (Facebook +
 * Instagram ad accounts share one API). Read-focused like the googleAds
 * node above.
 * credential (type 'metaAds'): { accessToken: string, adAccountId: string }
 *   (adAccountId like "act_1234567890" — the "act_" prefix Meta expects)
 * params: { fields?: string, datePreset?: string, level?: 'campaign' | 'adset' | 'ad' }
 */
export const metaAdsNode: NodePlugin = {
  type: 'metaAds',
  async execute({ params, credential }) {
    const accessToken = credential?.accessToken as string;
    const adAccountId = credential?.adAccountId as string;
    if (!accessToken || !adAccountId) {
      throw new Error('metaAds node: requires a "metaAds" credential with { "accessToken", "adAccountId" }');
    }
    const fields = (params.fields as string) ?? 'campaign_name,impressions,clicks,spend';
    try {
      const response = await axios.get(`https://graph.facebook.com/v19.0/${adAccountId}/insights`, {
        params: {
          access_token: accessToken,
          fields,
          date_preset: (params.datePreset as string) ?? 'last_7d',
          level: (params.level as string) ?? 'campaign',
        },
        timeout: 20000,
      });
      return { output: response.data };
    } catch (err) {
      throw wrapIntegrationError('metaAds', err);
    }
  },
};

/**
 * amplitude — product-analytics event tracking (HTTP V2 API).
 * credential (type 'amplitude'): { apiKey: string }
 * params: { eventType: string, userId?: string, deviceId?: string, eventProperties?: object, userProperties?: object }
 *   (Amplitude requires at least one of userId/deviceId per event.)
 */
export const amplitudeNode: NodePlugin = {
  type: 'amplitude',
  async execute({ params, credential }) {
    const apiKey = credential?.apiKey as string;
    if (!apiKey) throw new Error('amplitude node: requires an "amplitude" credential with { "apiKey" }');
    if (!params.eventType) throw new Error('amplitude node: requires "eventType"');
    if (!params.userId && !params.deviceId) throw new Error('amplitude node: requires "userId" or "deviceId"');
    try {
      const response = await axios.post(
        'https://api2.amplitude.com/2/httpapi',
        {
          api_key: apiKey,
          events: [
            {
              event_type: params.eventType,
              user_id: params.userId,
              device_id: params.deviceId,
              event_properties: params.eventProperties ?? {},
              user_properties: params.userProperties ?? {},
              time: Date.now(),
            },
          ],
        },
        { timeout: 15000 }
      );
      return { output: response.data };
    } catch (err) {
      throw wrapIntegrationError('amplitude', err);
    }
  },
};

/**
 * mixpanel — product-analytics event tracking, alternative to Amplitude.
 * credential (type 'mixpanel'): { projectToken: string }
 * params: { eventName: string, distinctId?: string, properties?: object }
 */
export const mixpanelNode: NodePlugin = {
  type: 'mixpanel',
  async execute({ params, credential }) {
    const projectToken = credential?.projectToken as string;
    if (!projectToken) throw new Error('mixpanel node: requires a "mixpanel" credential with { "projectToken" }');
    if (!params.eventName) throw new Error('mixpanel node: requires "eventName"');
    try {
      const payload = [
        {
          event: params.eventName,
          properties: {
            token: projectToken,
            distinct_id: params.distinctId,
            time: Math.floor(Date.now() / 1000),
            ...((params.properties as Record<string, unknown>) ?? {}),
          },
        },
      ];
      const response = await axios.post('https://api.mixpanel.com/track', payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
      });
      return { output: response.data };
    } catch (err) {
      throw wrapIntegrationError('mixpanel', err);
    }
  },
};

registerNode(mailchimpNode);
registerNode(sendgridNode);
registerNode(segmentNode);
registerNode(googleAdsNode);
registerNode(metaAdsNode);
registerNode(amplitudeNode);
registerNode(mixpanelNode);
