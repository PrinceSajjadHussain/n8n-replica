import axios from 'axios';
import { registerNode } from './types';
import type { NodePlugin } from './types';
import { wrapIntegrationError } from './integrationErrors';

/**
 * msTeams — posts an Adaptive Card / plain message to a channel via an
 * Incoming Webhook connector (same pattern as slack/discord — no OAuth app
 * registration required for the common case).
 * credential (type 'msTeams'): { webhookUrl: string }
 * params: { text: string, title?: string }
 */
export const msTeamsNode: NodePlugin = {
  type: 'msTeams',
  async execute({ params, credential }) {
    const webhookUrl = credential?.webhookUrl as string;
    if (!webhookUrl) throw new Error('msTeams node: requires a "msTeams" credential with { "webhookUrl": "..." }');
    try {
      const response = await axios.post(
        webhookUrl,
        {
          '@type': 'MessageCard',
          '@context': 'http://schema.org/extensions',
          title: params.title ?? undefined,
          text: String(params.text ?? ''),
        },
        { timeout: 15000 }
      );
      return { output: { status: response.status } };
    } catch (err) {
      throw wrapIntegrationError('msTeams', err);
    }
  },
};

/**
 * outlook — mail + calendar via Microsoft Graph, parallel to the Gmail /
 * Google Calendar nodes. Uses an OAuth access token obtained through the
 * Microsoft OAuth flow (see apps/api/src/config/oauthProviders.ts).
 * credential (type 'microsoft-oauth2'): { accessToken: string, refreshToken?: string }
 *   (short-lived like the Google OAuth credential — a 401 here means
 *   "reconnect Microsoft" on the Credentials page, not a code bug.)
 * params:
 *   action: 'sendMail' | 'listEvents' | 'createEvent'
 *   to?, subject?, body? (sendMail)
 *   calendarId?, timeMin?, timeMax? (listEvents)
 *   event? (createEvent — Graph event shape)
 */
export const outlookNode: NodePlugin = {
  type: 'outlook',
  async execute({ params, credential }) {
    const accessToken = credential?.accessToken as string;
    if (!accessToken) {
      throw new Error(
        'outlook node: no Microsoft credential attached — go to Credentials → Connect with Microsoft, then select that credential on this node.'
      );
    }
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
    const base = 'https://graph.microsoft.com/v1.0';
    const action = String(params.action ?? 'sendMail');
    try {
      if (action === 'sendMail') {
        await axios.post(
          `${base}/me/sendMail`,
          {
            message: {
              subject: params.subject,
              body: { contentType: 'Text', content: String(params.body ?? '') },
              toRecipients: [{ emailAddress: { address: params.to } }],
            },
          },
          { headers, timeout: 15000 }
        );
        return { output: { sent: true } };
      }
      if (action === 'listEvents') {
        const response = await axios.get(`${base}/me/calendarView`, {
          headers,
          params: { startDateTime: params.timeMin, endDateTime: params.timeMax },
          timeout: 15000,
        });
        return { output: response.data };
      }
      if (action === 'createEvent') {
        const response = await axios.post(`${base}/me/events`, params.event ?? {}, { headers, timeout: 15000 });
        return { output: response.data };
      }
      throw new Error(`outlook node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('outlook', err);
    }
  },
};

/**
 * googleDrive — upload/download/list, via the Drive v3 REST API. Separate
 * from the Sheets node; shares the same OAuth credential type since the
 * "Connect with Google" flow already requests drive scope.
 * credential (type 'google-oauth2'): { accessToken: string }
 * params:
 *   action: 'listFiles' | 'uploadFile' | 'downloadFile'
 *   query? (listFiles — Drive search query)
 *   fileId? (downloadFile)
 *   fileName?, mimeType?, content? (uploadFile — content is plain text; use
 *     the file-extract/convert nodes upstream for binary uploads)
 */
export const googleDriveNode: NodePlugin = {
  type: 'googleDrive',
  async execute({ params, credential }) {
    const accessToken = credential?.accessToken as string;
    if (!accessToken) {
      throw new Error(
        'googleDrive node: no Google credential attached — go to Credentials → Connect with Google, then select that credential on this node.'
      );
    }
    const headers = { Authorization: `Bearer ${accessToken}` };
    const action = String(params.action ?? 'listFiles');
    try {
      if (action === 'listFiles') {
        const response = await axios.get('https://www.googleapis.com/drive/v3/files', {
          headers,
          params: { q: params.query, fields: 'files(id,name,mimeType,modifiedTime,webViewLink)' },
          timeout: 15000,
        });
        return { output: response.data };
      }
      if (action === 'downloadFile') {
        const response = await axios.get(
          `https://www.googleapis.com/drive/v3/files/${params.fileId}?alt=media`,
          { headers, responseType: 'arraybuffer', timeout: 30000 }
        );
        return { output: { fileId: params.fileId, byteLength: response.data.length } };
      }
      if (action === 'uploadFile') {
        const boundary = 'flowforge-boundary';
        const metadata = JSON.stringify({ name: params.fileName, mimeType: params.mimeType ?? 'text/plain' });
        const body =
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
          `--${boundary}\r\nContent-Type: ${params.mimeType ?? 'text/plain'}\r\n\r\n${String(params.content ?? '')}\r\n` +
          `--${boundary}--`;
        const response = await axios.post(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
          body,
          { headers: { ...headers, 'Content-Type': `multipart/related; boundary=${boundary}` }, timeout: 30000 }
        );
        return { output: response.data };
      }
      throw new Error(`googleDrive node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('googleDrive', err);
    }
  },
};

/**
 * dropbox — upload/download/list via the Dropbox v2 API.
 * credential (type 'dropbox'): { accessToken: string }
 * params:
 *   action: 'listFolder' | 'uploadFile' | 'downloadFile'
 *   path?: string  ("" for root)
 *   content?: string (uploadFile — plain text)
 */
export const dropboxNode: NodePlugin = {
  type: 'dropbox',
  async execute({ params, credential }) {
    const accessToken = credential?.accessToken as string;
    if (!accessToken) throw new Error('dropbox node: requires a "dropbox" credential with { "accessToken": "..." }');
    const headers = { Authorization: `Bearer ${accessToken}` };
    const action = String(params.action ?? 'listFolder');
    try {
      if (action === 'listFolder') {
        const response = await axios.post(
          'https://api.dropboxapi.com/2/files/list_folder',
          { path: params.path ?? '' },
          { headers, timeout: 15000 }
        );
        return { output: response.data };
      }
      if (action === 'uploadFile') {
        const response = await axios.post(
          'https://content.dropboxapi.com/2/files/upload',
          String(params.content ?? ''),
          {
            headers: {
              ...headers,
              'Content-Type': 'application/octet-stream',
              'Dropbox-API-Arg': JSON.stringify({ path: params.path, mode: 'overwrite' }),
            },
            timeout: 30000,
          }
        );
        return { output: response.data };
      }
      if (action === 'downloadFile') {
        const response = await axios.post('https://content.dropboxapi.com/2/files/download', null, {
          headers: { ...headers, 'Dropbox-API-Arg': JSON.stringify({ path: params.path }) },
          responseType: 'arraybuffer',
          timeout: 30000,
        });
        return { output: { path: params.path, byteLength: response.data.length } };
      }
      throw new Error(`dropbox node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('dropbox', err);
    }
  },
};

/**
 * zoom — create meetings / list recordings via the Zoom REST API v2.
 * credential (type 'zoom'): { accessToken: string } (Server-to-Server OAuth
 *   token — see marketplace.zoom.us; short-lived, ~1hr, so a 401 usually
 *   means the credential needs refreshing.)
 * params:
 *   action: 'createMeeting' | 'listRecordings' | 'getMeeting'
 *   topic?, startTime?, duration? (createMeeting)
 *   meetingId? (getMeeting)
 *   userId?, from?, to? (listRecordings)
 */
export const zoomNode: NodePlugin = {
  type: 'zoom',
  async execute({ params, credential }) {
    const accessToken = credential?.accessToken as string;
    if (!accessToken) throw new Error('zoom node: requires a "zoom" credential with { "accessToken": "..." }');
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
    const base = 'https://api.zoom.us/v2';
    const action = String(params.action ?? 'createMeeting');
    try {
      if (action === 'createMeeting') {
        const response = await axios.post(
          `${base}/users/me/meetings`,
          { topic: params.topic, start_time: params.startTime, duration: params.duration ?? 30, type: params.startTime ? 2 : 1 },
          { headers, timeout: 15000 }
        );
        return { output: response.data };
      }
      if (action === 'getMeeting') {
        const response = await axios.get(`${base}/meetings/${params.meetingId}`, { headers, timeout: 15000 });
        return { output: response.data };
      }
      if (action === 'listRecordings') {
        const response = await axios.get(`${base}/users/${params.userId ?? 'me'}/recordings`, {
          headers,
          params: { from: params.from, to: params.to },
          timeout: 15000,
        });
        return { output: response.data };
      }
      throw new Error(`zoom node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('zoom', err);
    }
  },
};

registerNode(msTeamsNode);
registerNode(outlookNode);
registerNode(googleDriveNode);
registerNode(dropboxNode);
registerNode(zoomNode);
