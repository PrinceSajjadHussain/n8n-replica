import axios from 'axios';
import { registerNode } from './types';
import type { NodePlugin } from './types';
import { wrapIntegrationError } from './integrationErrors';

/**
 * calendly — read-side booking data (invitees, event listing, cancel).
 * The "booking webhook trigger" half of this integration doesn't need a
 * dedicated trigger node type: Calendly delivers booking events as a
 * regular signed webhook, so it's wired the same way every other
 * third-party webhook is in FlowForge — a normal 'webhook' trigger node,
 * with the workflow's Code/If nodes reading `X-Calendly-Webhook-Signature`
 * for verification (HMAC-SHA256 over the raw body with the org's signing
 * key) rather than a bespoke trigger type. This node covers the action
 * side: looking up/cancelling bookings from inside a workflow.
 * credential (type 'calendly'): { apiToken: string }
 * params:
 *   action: 'listEvents' | 'getInvitee' | 'cancelEvent'
 *   userUri? (listEvents — Calendly user URI; omit to use "me")
 *   eventUuid? (getInvitee, cancelEvent)
 *   inviteeUuid? (getInvitee)
 *   reason? (cancelEvent)
 */
export const calendlyNode: NodePlugin = {
  type: 'calendly',
  async execute({ params, credential }) {
    const apiToken = credential?.apiToken as string;
    if (!apiToken) throw new Error('calendly node: requires a "calendly" credential with { "apiToken" }');
    const headers = { Authorization: `Bearer ${apiToken}` };
    const base = 'https://api.calendly.com';
    const action = String(params.action ?? 'listEvents');
    try {
      if (action === 'listEvents') {
        let userUri = params.userUri as string | undefined;
        if (!userUri) {
          const me = await axios.get(`${base}/users/me`, { headers, timeout: 15000 });
          userUri = me.data.resource.uri;
        }
        const response = await axios.get(`${base}/scheduled_events`, { headers, params: { user: userUri }, timeout: 15000 });
        return { output: response.data };
      }
      if (action === 'getInvitee') {
        if (!params.eventUuid || !params.inviteeUuid) {
          throw new Error('calendly node: "getInvitee" requires "eventUuid" and "inviteeUuid"');
        }
        const response = await axios.get(
          `${base}/scheduled_events/${params.eventUuid}/invitees/${params.inviteeUuid}`,
          { headers, timeout: 15000 }
        );
        return { output: response.data };
      }
      if (action === 'cancelEvent') {
        if (!params.eventUuid) throw new Error('calendly node: "cancelEvent" requires "eventUuid"');
        const response = await axios.post(
          `${base}/scheduled_events/${params.eventUuid}/cancellation`,
          { reason: params.reason ?? '' },
          { headers, timeout: 15000 }
        );
        return { output: response.data };
      }
      throw new Error(`calendly node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('calendly', err);
    }
  },
};

/**
 * docusign — send an envelope for signature and check its status.
 * "Webhook on completion" is handled the same way as Calendly above: point
 * a DocuSign Connect configuration at FlowForge's generic 'webhook'
 * trigger URL rather than a dedicated trigger node — DocuSign Connect
 * posts a signed XML/JSON payload on envelope-completed, which downstream
 * If/Code nodes can branch on.
 * credential (type 'docusign'): { accessToken: string, accountId: string, basePath?: string }
 *   (basePath defaults to the demo/sandbox base; set it to the production
 *   base URL returned by DocuSign's OAuth userinfo endpoint for live use.)
 * params:
 *   action: 'sendEnvelope' | 'getEnvelopeStatus'
 *   envelope? (sendEnvelope — DocuSign envelope definition body)
 *   envelopeId? (getEnvelopeStatus)
 */
export const docusignNode: NodePlugin = {
  type: 'docusign',
  async execute({ params, credential }) {
    const accessToken = credential?.accessToken as string;
    const accountId = credential?.accountId as string;
    if (!accessToken || !accountId) {
      throw new Error('docusign node: requires a "docusign" credential with { "accessToken", "accountId" }');
    }
    const basePath = (credential?.basePath as string) || 'https://demo.docusign.net/restapi';
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
    const base = `${basePath}/v2.1/accounts/${accountId}`;
    const action = String(params.action ?? 'sendEnvelope');
    try {
      if (action === 'sendEnvelope') {
        const response = await axios.post(`${base}/envelopes`, params.envelope ?? {}, { headers, timeout: 20000 });
        return { output: response.data };
      }
      if (action === 'getEnvelopeStatus') {
        if (!params.envelopeId) throw new Error('docusign node: "getEnvelopeStatus" requires "envelopeId"');
        const response = await axios.get(`${base}/envelopes/${params.envelopeId}`, { headers, timeout: 15000 });
        return { output: response.data };
      }
      throw new Error(`docusign node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('docusign', err);
    }
  },
};

registerNode(calendlyNode);
registerNode(docusignNode);
