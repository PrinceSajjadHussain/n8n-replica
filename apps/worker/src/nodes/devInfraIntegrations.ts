import axios from 'axios';
import { registerNode } from './types';
import type { NodePlugin } from './types';
import { wrapIntegrationError } from './integrationErrors';
import { rlValue } from './resourceLocatorValue';

/**
 * mongodb — NoSQL counterpart to the Postgres node. Connects fresh per
 * execution and closes it afterward (same tradeoff/rationale as postgres:
 * simple and safe for workflow-triggered volumes, swap for a pooled client
 * if you need high-frequency execution).
 * credential (type 'mongodb'): { connectionString: string } ("mongodb+srv://...")
 * params:
 *   database: string, collection: string
 *   action: 'find' | 'insertOne' | 'updateOne' | 'deleteOne'
 *   filter?: object, update?: object, document?: object
 *
 * Requires the `mongodb` driver package — lazily imported (like the Stripe
 * client in apps/api/src/routes/billing.ts) so it's only a hard failure if
 * this node is actually used without the dependency installed.
 */
export const mongodbNode: NodePlugin = {
  type: 'mongodb',
  async execute({ params, credential }) {
    const connectionString = credential?.connectionString as string;
    if (!connectionString)
      throw new Error('mongodb node: requires a "mongodb" credential with { "connectionString": "mongodb+srv://..." }');
    const database = String(params.database ?? '');
    const collection = String(rlValue(params.collection) ?? '');
    if (!database || !collection) throw new Error('mongodb node: "database" and "collection" params are required');
    const action = String(params.action ?? 'find');

    let MongoClient: any;
    try {
      ({ MongoClient } = await import('mongodb'));
    } catch {
      throw new Error('mongodb node: the "mongodb" driver package is not installed — run `npm install mongodb` in apps/worker.');
    }

    const client = new MongoClient(connectionString);
    try {
      await client.connect();
      const coll = client.db(database).collection(collection);
      if (action === 'find') {
        const docs = await coll.find(params.filter ?? {}).limit(Number(params.limit ?? 100)).toArray();
        return { output: docs };
      }
      if (action === 'insertOne') {
        const result = await coll.insertOne(params.document ?? {});
        return { output: { insertedId: result.insertedId } };
      }
      if (action === 'updateOne') {
        const result = await coll.updateOne(params.filter ?? {}, params.update ?? {});
        return { output: { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount } };
      }
      if (action === 'deleteOne') {
        const result = await coll.deleteOne(params.filter ?? {});
        return { output: { deletedCount: result.deletedCount } };
      }
      throw new Error(`mongodb node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('mongodb', err);
    } finally {
      await client.close();
    }
  },
};

/**
 * mysql — generic SQL node, parallel to the Postgres node.
 * credential (type 'mysql'): { connectionString: string } ("mysql://user:pass@host:3306/db")
 * params: { query: string, values?: unknown[] }
 * Requires the `mysql2` package — lazily imported for the same reason as
 * the mongodb driver above.
 */
export const mysqlNode: NodePlugin = {
  type: 'mysql',
  async execute({ params, credential }) {
    const connectionString = credential?.connectionString as string;
    if (!connectionString)
      throw new Error('mysql node: requires a "mysql" credential with { "connectionString": "mysql://..." }');
    const query = String(params.query ?? '');
    if (!query) throw new Error('mysql node: "query" param is required');

    let mysql: any;
    try {
      mysql = await import('mysql2/promise');
    } catch {
      throw new Error('mysql node: the "mysql2" package is not installed — run `npm install mysql2` in apps/worker.');
    }

    const connection = await mysql.createConnection(connectionString);
    try {
      const [rows] = await connection.execute(query, (params.values as unknown[]) ?? []);
      return { output: { rows } };
    } catch (err) {
      throw wrapIntegrationError('mysql', err);
    } finally {
      await connection.end();
    }
  },
};

/**
 * sentry — read/manage issues via the Sentry API. (Ingesting *new* errors
 * from your own app goes through the Sentry SDK, not this node — this
 * covers workflow-side actions: listing, triaging, and resolving.)
 * credential (type 'sentry'): { authToken: string, organizationSlug: string }
 * params:
 *   action: 'listIssues' | 'getIssue' | 'resolveIssue'
 *   projectSlug? (listIssues), issueId?, query? (listIssues search filter)
 */
export const sentryNode: NodePlugin = {
  type: 'sentry',
  async execute({ params, credential }) {
    const authToken = credential?.authToken as string;
    const organizationSlug = credential?.organizationSlug as string;
    if (!authToken || !organizationSlug)
      throw new Error('sentry node: requires a "sentry" credential with { "authToken", "organizationSlug" }');
    const headers = { Authorization: `Bearer ${authToken}` };
    const base = `https://sentry.io/api/0/organizations/${organizationSlug}`;
    const action = String(params.action ?? 'listIssues');
    try {
      if (action === 'listIssues') {
        const response = await axios.get(`${base}/issues/`, {
          headers,
          params: { project: params.projectSlug, query: params.query ?? 'is:unresolved' },
          timeout: 15000,
        });
        return { output: response.data };
      }
      if (action === 'getIssue') {
        const response = await axios.get(`https://sentry.io/api/0/issues/${params.issueId}/`, { headers, timeout: 15000 });
        return { output: response.data };
      }
      if (action === 'resolveIssue') {
        const response = await axios.put(
          `https://sentry.io/api/0/issues/${params.issueId}/`,
          { status: 'resolved' },
          { headers, timeout: 15000 }
        );
        return { output: response.data };
      }
      throw new Error(`sentry node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('sentry', err);
    }
  },
};

/**
 * pagerduty — trigger/acknowledge/resolve incidents via the Events API v2
 * (routing key, no user token needed — the common workflow-alert case),
 * plus listing incidents via the REST API v2 when a full API token is given.
 * credential (type 'pagerduty'): { routingKey?: string, apiToken?: string }
 * params:
 *   action: 'triggerIncident' | 'acknowledgeIncident' | 'resolveIncident' | 'listIncidents'
 *   summary?, source?, severity? (triggerIncident), dedupKey? (ack/resolve)
 */
export const pagerdutyNode: NodePlugin = {
  type: 'pagerduty',
  async execute({ params, credential }) {
    const routingKey = credential?.routingKey as string | undefined;
    const apiToken = credential?.apiToken as string | undefined;
    const action = String(params.action ?? 'triggerIncident');
    try {
      if (action === 'triggerIncident' || action === 'acknowledgeIncident' || action === 'resolveIncident') {
        if (!routingKey)
          throw new Error('pagerduty node: this action requires a "pagerduty" credential with { "routingKey" }');
        const eventAction = action === 'triggerIncident' ? 'trigger' : action === 'acknowledgeIncident' ? 'acknowledge' : 'resolve';
        const response = await axios.post(
          'https://events.pagerduty.com/v2/enqueue',
          {
            routing_key: routingKey,
            event_action: eventAction,
            dedup_key: params.dedupKey,
            payload:
              eventAction === 'trigger'
                ? { summary: params.summary, source: params.source ?? 'flowforge', severity: params.severity ?? 'error' }
                : undefined,
          },
          { timeout: 15000 }
        );
        return { output: response.data };
      }
      if (action === 'listIncidents') {
        if (!apiToken) throw new Error('pagerduty node: "listIncidents" requires a "pagerduty" credential with { "apiToken" }');
        const response = await axios.get('https://api.pagerduty.com/incidents', {
          headers: { Authorization: `Token token=${apiToken}` },
          timeout: 15000,
        });
        return { output: response.data };
      }
      throw new Error(`pagerduty node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('pagerduty', err);
    }
  },
};

/**
 * datadog — push metrics/logs, or query metrics, via the Datadog API v1/v2.
 * credential (type 'datadog'): { apiKey: string, appKey?: string, site?: string }
 *   (site defaults to "datadoghq.com" — set to "datadoghq.eu" etc. for other regions)
 * params:
 *   action: 'submitMetric' | 'submitLog' | 'queryMetrics'
 *   metricName?, value?, tags?: string[] (submitMetric)
 *   message?, service?, ddsource? (submitLog)
 *   query?, from?, to? (queryMetrics — requires appKey)
 */
export const datadogNode: NodePlugin = {
  type: 'datadog',
  async execute({ params, credential }) {
    const apiKey = credential?.apiKey as string;
    if (!apiKey) throw new Error('datadog node: requires a "datadog" credential with { "apiKey": "..." }');
    const site = (credential?.site as string) ?? 'datadoghq.com';
    const action = String(params.action ?? 'submitMetric');
    try {
      if (action === 'submitMetric') {
        const response = await axios.post(
          `https://api.${site}/api/v2/series`,
          {
            series: [
              {
                metric: params.metricName,
                type: 0,
                points: [{ timestamp: Math.floor(Date.now() / 1000), value: Number(params.value ?? 0) }],
                tags: params.tags ?? [],
              },
            ],
          },
          { headers: { 'DD-API-KEY': apiKey, 'Content-Type': 'application/json' }, timeout: 15000 }
        );
        return { output: response.data };
      }
      if (action === 'submitLog') {
        const response = await axios.post(
          `https://http-intake.logs.${site}/api/v2/logs`,
          [{ message: params.message, service: params.service, ddsource: params.ddsource ?? 'flowforge' }],
          { headers: { 'DD-API-KEY': apiKey, 'Content-Type': 'application/json' }, timeout: 15000 }
        );
        return { output: response.data };
      }
      if (action === 'queryMetrics') {
        const appKey = credential?.appKey as string;
        if (!appKey) throw new Error('datadog node: "queryMetrics" requires the credential to also include "appKey"');
        const response = await axios.get(`https://api.${site}/api/v1/query`, {
          headers: { 'DD-API-KEY': apiKey, 'DD-APPLICATION-KEY': appKey },
          params: { query: params.query, from: params.from, to: params.to },
          timeout: 15000,
        });
        return { output: response.data };
      }
      throw new Error(`datadog node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('datadog', err);
    }
  },
};

/**
 * elasticsearch — index/search documents against Elasticsearch or an
 * OpenSearch cluster (both speak the same REST wire protocol for the
 * operations this node needs, so one node covers both — no separate
 * client library needed, it's a plain REST API over HTTP like httpRequest,
 * just with auth/index handling baked in).
 * credential (type 'elasticsearch'): { node: string, apiKey?: string, username?: string, password?: string }
 *   (node is the cluster URL, e.g. "https://my-cluster.es.io:9243"; use
 *   either apiKey OR username+password, not both)
 * params:
 *   action: 'search' | 'index' | 'delete' (default 'search')
 *   index: string (required)
 *   query? (search — full ES query DSL body; defaults to match_all)
 *   document? (index — document body)
 *   id? (index — optional explicit doc id; delete — required doc id)
 */
export const elasticsearchNode: NodePlugin = {
  type: 'elasticsearch',
  async execute({ params, credential }) {
    const node = credential?.node as string;
    if (!node) throw new Error('elasticsearch node: requires an "elasticsearch" credential with { "node" }');
    const index = String(params.index ?? '');
    if (!index) throw new Error('elasticsearch node: "index" param is required');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const auth = credential?.username
      ? { username: credential.username as string, password: (credential.password as string) ?? '' }
      : undefined;
    if (credential?.apiKey) headers.Authorization = `ApiKey ${credential.apiKey}`;
    const action = String(params.action ?? 'search');
    try {
      if (action === 'search') {
        const response = await axios.post(`${node}/${index}/_search`, params.query ?? { query: { match_all: {} } }, {
          headers,
          auth,
          timeout: 20000,
        });
        return { output: response.data };
      }
      if (action === 'index') {
        const url = params.id ? `${node}/${index}/_doc/${params.id}` : `${node}/${index}/_doc`;
        const response = await axios.post(url, params.document ?? {}, { headers, auth, timeout: 15000 });
        return { output: response.data };
      }
      if (action === 'delete') {
        if (!params.id) throw new Error('elasticsearch node: "delete" requires "id"');
        const response = await axios.delete(`${node}/${index}/_doc/${params.id}`, { headers, auth, timeout: 15000 });
        return { output: response.data };
      }
      throw new Error(`elasticsearch node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('elasticsearch', err);
    }
  },
};

/**
 * sftp — generic SFTP/FTP file transfer node. `protocol` param picks the
 * wire protocol; both drivers are lazily imported (same rationale as
 * mongodb/mysql above) so they're only a hard failure if this node is
 * actually used without the dependency installed.
 * credential (type 'sftp'): { host: string, port?: number, username: string, password?: string, privateKey?: string }
 *   (privateKey is SFTP-only; FTP always uses username+password)
 * params:
 *   protocol: 'sftp' | 'ftp' (default 'sftp')
 *   action: 'list' | 'upload' | 'download' | 'delete'
 *   remotePath: string (required)
 *   content? (upload — text content to write; for binary payloads pass
 *     the upstream item's binary through `getBinary`/`toBinary` instead)
 */
export const sftpNode: NodePlugin = {
  type: 'sftp',
  async execute({ params, credential, toBinary }) {
    const host = credential?.host as string;
    const username = credential?.username as string;
    if (!host || !username) throw new Error('sftp node: requires a "sftp" credential with { "host", "username" }');
    const remotePath = String(params.remotePath ?? '');
    if (!remotePath) throw new Error('sftp node: "remotePath" param is required');
    const protocol = (params.protocol as string) === 'ftp' ? 'ftp' : 'sftp';
    const action = String(params.action ?? 'list');

    try {
      if (protocol === 'sftp') {
        let SftpClient: any;
        try {
          SftpClient = (await import('ssh2-sftp-client')).default;
        } catch {
          throw new Error('sftp node: the "ssh2-sftp-client" package is not installed — run `npm install ssh2-sftp-client` in apps/worker.');
        }
        const client = new SftpClient();
        try {
          await client.connect({
            host,
            port: Number(credential?.port ?? 22),
            username,
            password: credential?.password as string | undefined,
            privateKey: credential?.privateKey as string | undefined,
          });
          if (action === 'list') return { output: await client.list(remotePath) };
          if (action === 'upload') {
            const buf = Buffer.from(String(params.content ?? ''), 'utf-8');
            await client.put(buf, remotePath);
            return { output: { uploaded: true, remotePath } };
          }
          if (action === 'download') {
            const buf = (await client.get(remotePath)) as Buffer;
            return { items: [{ json: { remotePath }, binary: { data: toBinary(buf, 'application/octet-stream', remotePath.split('/').pop()) } }] };
          }
          if (action === 'delete') {
            await client.delete(remotePath);
            return { output: { deleted: true, remotePath } };
          }
          throw new Error(`sftp node: unknown action "${action}"`);
        } finally {
          await client.end().catch(() => {});
        }
      }

      // FTP
      let ftpClientModule: any;
      try {
        ftpClientModule = await import('basic-ftp');
      } catch {
        throw new Error('sftp node: the "basic-ftp" package is not installed — run `npm install basic-ftp` in apps/worker.');
      }
      const client = new ftpClientModule.Client();
      try {
        await client.access({
          host,
          port: Number(credential?.port ?? 21),
          user: username,
          password: (credential?.password as string) ?? '',
        });
        if (action === 'list') return { output: await client.list(remotePath) };
        if (action === 'delete') {
          await client.remove(remotePath);
          return { output: { deleted: true, remotePath } };
        }
        throw new Error(`sftp node: action "${action}" over FTP requires a local file path — use "list" or "delete", or switch to protocol "sftp" for buffer-based upload/download`);
      } finally {
        client.close();
      }
    } catch (err) {
      throw wrapIntegrationError('sftp', err);
    }
  },
};

registerNode(mongodbNode);
registerNode(mysqlNode);
registerNode(sentryNode);
registerNode(pagerdutyNode);
registerNode(datadogNode);
registerNode(elasticsearchNode);
registerNode(sftpNode);
