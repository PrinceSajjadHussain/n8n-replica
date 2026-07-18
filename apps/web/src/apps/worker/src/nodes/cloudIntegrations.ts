import axios from 'axios';
import crypto from 'crypto';
import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * Minimal AWS Signature V4 signer (dependency-free — no @aws-sdk needed).
 * Supports the S3 REST API (put/get/list/delete object) which is enough for
 * the vast majority of workflow use cases without pulling in the full SDK.
 */
function sigv4Sign(opts: {
  method: string;
  host: string;
  path: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body: Buffer;
}) {
  const { method, host, path, region, service, accessKeyId, secretAccessKey, sessionToken, body } = opts;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = crypto.createHash('sha256').update(body).digest('hex');

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(sessionToken ? { 'x-amz-security-token': sessionToken } : {}),
    ...opts.headers,
  };
  const sortedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${headers[k]}\n`).join('');
  const signedHeaders = sortedHeaderKeys.join(';');

  const query = opts.query ?? {};
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join('&');

  const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const hmac = (key: Buffer | string, data: string) => crypto.createHmac('sha256', key).update(data).digest();
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers: { ...headers, Authorization: authorization }, query };
}

/**
 * awsS3 — put/get/list/delete objects in an S3 (or S3-compatible) bucket.
 * credential (type 'aws'): { accessKeyId, secretAccessKey, region, sessionToken? }
 * params:
 *   action: 'putObject' | 'getObject' | 'listObjects' | 'deleteObject'
 *   bucket: string, key?: string, body?: string, prefix?: string
 */
export const awsS3Node: NodePlugin = {
  type: 'awsS3',
  async execute({ params, credential, getBinary, items }) {
    const accessKeyId = credential?.accessKeyId as string;
    const secretAccessKey = credential?.secretAccessKey as string;
    const region = (credential?.region as string) ?? 'us-east-1';
    if (!accessKeyId || !secretAccessKey)
      throw new Error('awsS3 node: requires an "aws" credential with { "accessKeyId", "secretAccessKey", "region" }');

    const bucket = String(params.bucket ?? '');
    if (!bucket) throw new Error('awsS3 node: "bucket" param is required');
    const host = `${bucket}.s3.${region}.amazonaws.com`;
    const action = String(params.action ?? 'listObjects');

    if (action === 'putObject') {
      const key = String(params.key ?? '');
      const binary = items[0] ? getBinary(items[0]) : null;
      const body = binary ?? Buffer.from(typeof params.body === 'string' ? params.body : JSON.stringify(params.body ?? ''));
      const { headers } = sigv4Sign({
        method: 'PUT',
        host,
        path: `/${key}`,
        region,
        service: 's3',
        accessKeyId,
        secretAccessKey,
        sessionToken: credential?.sessionToken as string | undefined,
        body,
      });
      const response = await axios.put(`https://${host}/${key}`, body, { headers, timeout: 30000 });
      return { output: { status: response.status, key, bucket, url: `https://${host}/${key}` } };
    }
    if (action === 'getObject') {
      const key = String(params.key ?? '');
      const { headers } = sigv4Sign({
        method: 'GET',
        host,
        path: `/${key}`,
        region,
        service: 's3',
        accessKeyId,
        secretAccessKey,
        sessionToken: credential?.sessionToken as string | undefined,
        body: Buffer.alloc(0),
      });
      const response = await axios.get(`https://${host}/${key}`, { headers, timeout: 30000, responseType: 'arraybuffer' });
      const text = Buffer.from(response.data).toString('utf-8');
      return { output: { key, bucket, size: response.data.length, body: text } };
    }
    if (action === 'listObjects') {
      const query = { 'list-type': '2', prefix: String(params.prefix ?? '') };
      const { headers } = sigv4Sign({
        method: 'GET',
        host,
        path: '/',
        region,
        service: 's3',
        accessKeyId,
        secretAccessKey,
        sessionToken: credential?.sessionToken as string | undefined,
        query,
        body: Buffer.alloc(0),
      });
      const response = await axios.get(`https://${host}/`, { headers, params: query, timeout: 30000 });
      return { output: response.data };
    }
    if (action === 'deleteObject') {
      const key = String(params.key ?? '');
      const { headers } = sigv4Sign({
        method: 'DELETE',
        host,
        path: `/${key}`,
        region,
        service: 's3',
        accessKeyId,
        secretAccessKey,
        sessionToken: credential?.sessionToken as string | undefined,
        body: Buffer.alloc(0),
      });
      const response = await axios.delete(`https://${host}/${key}`, { headers, timeout: 30000 });
      return { output: { status: response.status, deleted: key } };
    }
    throw new Error(`awsS3 node: unknown action "${action}"`);
  },
};

/**
 * gmail — send email / list messages via the Gmail API. Uses an OAuth access
 * token (obtained through the existing oauthProviders.ts Google flow).
 * credential (type 'google'): { accessToken: string }
 * params: { action: 'send'|'list', to?, subject?, body?, query? }
 */
export const gmailNode: NodePlugin = {
  type: 'gmail',
  async execute({ params, credential }) {
    const accessToken = credential?.accessToken as string;
    if (!accessToken) throw new Error('gmail node: requires a "google" credential with { "accessToken": "..." }');
    const headers = { Authorization: `Bearer ${accessToken}` };
    const action = String(params.action ?? 'send');

    if (action === 'send') {
      const to = String(params.to ?? '');
      const subject = String(params.subject ?? '');
      const body = String(params.body ?? '');
      const raw = Buffer.from(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}`)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      const response = await axios.post(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        { raw },
        { headers, timeout: 15000 }
      );
      return { output: response.data };
    }
    if (action === 'list') {
      const response = await axios.get('https://gmail.googleapis.com/gmail/v1/users/me/messages', {
        headers,
        params: { q: params.query ?? '' },
        timeout: 15000,
      });
      return { output: response.data };
    }
    throw new Error(`gmail node: unknown action "${action}"`);
  },
};

/**
 * googleCalendar — create/list/delete events via the Google Calendar API.
 * credential (type 'google'): { accessToken: string }
 * params: { action: 'createEvent'|'listEvents'|'deleteEvent', calendarId?, event?, eventId?, timeMin?, timeMax? }
 */
export const googleCalendarNode: NodePlugin = {
  type: 'googleCalendar',
  async execute({ params, credential }) {
    const accessToken = credential?.accessToken as string;
    if (!accessToken) throw new Error('googleCalendar node: requires a "google" credential with { "accessToken": "..." }');
    const headers = { Authorization: `Bearer ${accessToken}` };
    const calendarId = encodeURIComponent(String(params.calendarId ?? 'primary'));
    const base = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
    const action = String(params.action ?? 'listEvents');

    if (action === 'createEvent') {
      const response = await axios.post(base, params.event ?? {}, { headers, timeout: 15000 });
      return { output: response.data };
    }
    if (action === 'listEvents') {
      const response = await axios.get(base, {
        headers,
        params: { timeMin: params.timeMin, timeMax: params.timeMax },
        timeout: 15000,
      });
      return { output: response.data };
    }
    if (action === 'deleteEvent') {
      await axios.delete(`${base}/${params.eventId}`, { headers, timeout: 15000 });
      return { output: { deleted: params.eventId } };
    }
    throw new Error(`googleCalendar node: unknown action "${action}"`);
  },
};

registerNode(awsS3Node);
registerNode(gmailNode);
registerNode(googleCalendarNode);
