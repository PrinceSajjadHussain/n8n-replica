import axios from 'axios';
import { Client as PgClient } from 'pg';
import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * discord — posts to a Discord Incoming Webhook (same pattern as Slack).
 * credential (type 'discord'): { webhookUrl: string }
 * params: { content: string, username?: string }
 */
export const discordNode: NodePlugin = {
  type: 'discord',
  async execute({ params, credential }) {
    const webhookUrl = (credential?.webhookUrl as string) ?? (params.webhookUrl as string);
    if (!webhookUrl) throw new Error('discord node: requires a "discord" credential with { "webhookUrl": "..." }');
    const response = await axios.post(
      webhookUrl,
      { content: String(params.content ?? ''), username: params.username },
      { timeout: 15000 }
    );
    return { output: { status: response.status } };
  },
};

/**
 * telegram — sends a message via the Telegram Bot API.
 * credential (type 'telegram'): { botToken: string }
 * params: { chatId: string | number, text: string, parseMode?: 'Markdown'|'HTML' }
 */
export const telegramNode: NodePlugin = {
  type: 'telegram',
  async execute({ params, credential }) {
    const botToken = credential?.botToken as string;
    if (!botToken) throw new Error('telegram node: requires a "telegram" credential with { "botToken": "..." }');
    const chatId = params.chatId;
    if (!chatId) throw new Error('telegram node: "chatId" param is required');

    const response = await axios.post(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      { chat_id: chatId, text: String(params.text ?? ''), parse_mode: params.parseMode },
      { timeout: 15000 }
    );
    return { output: response.data };
  },
};

/**
 * notion — appends a page or block via the Notion API.
 * credential (type 'notion'): { apiKey: string }
 * params:
 *   action: 'createPage' | 'appendBlock' | 'queryDatabase'
 *   databaseId?: string   (createPage / queryDatabase)
 *   pageId?: string       (appendBlock)
 *   properties?: object   (createPage — Notion property schema)
 *   text?: string         (appendBlock — added as a paragraph block)
 *   filter?: object       (queryDatabase)
 */
export const notionNode: NodePlugin = {
  type: 'notion',
  async execute({ params, credential }) {
    const apiKey = credential?.apiKey as string;
    if (!apiKey) throw new Error('notion node: requires a "notion" credential with { "apiKey": "secret_..." }');
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    };
    const action = String(params.action ?? 'createPage');

    if (action === 'createPage') {
      const response = await axios.post(
        'https://api.notion.com/v1/pages',
        { parent: { database_id: params.databaseId }, properties: params.properties ?? {} },
        { headers, timeout: 15000 }
      );
      return { output: response.data };
    }
    if (action === 'appendBlock') {
      const response = await axios.patch(
        `https://api.notion.com/v1/blocks/${params.pageId}/children`,
        {
          children: [
            {
              object: 'block',
              type: 'paragraph',
              paragraph: { rich_text: [{ type: 'text', text: { content: String(params.text ?? '') } }] },
            },
          ],
        },
        { headers, timeout: 15000 }
      );
      return { output: response.data };
    }
    if (action === 'queryDatabase') {
      const response = await axios.post(
        `https://api.notion.com/v1/databases/${params.databaseId}/query`,
        { filter: params.filter },
        { headers, timeout: 15000 }
      );
      return { output: response.data };
    }
    throw new Error(`notion node: unknown action "${action}" (expected createPage/appendBlock/queryDatabase)`);
  },
};

/**
 * github — thin wrapper over the REST API for common actions.
 * credential (type 'github'): { token: string }
 * params:
 *   action: 'createIssue' | 'commentOnIssue' | 'getFile' | 'listIssues'
 *   owner, repo: string
 *   issueNumber?: number   (commentOnIssue)
 *   title?, body?: string  (createIssue)
 *   path?: string          (getFile)
 */
export const githubNode: NodePlugin = {
  type: 'github',
  async execute({ params, credential }) {
    const token = credential?.token as string;
    const headers = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: 'application/vnd.github+json',
    };
    const { owner, repo } = params as { owner: string; repo: string };
    const action = String(params.action ?? 'listIssues');
    const base = `https://api.github.com/repos/${owner}/${repo}`;

    if (action === 'listIssues') {
      const response = await axios.get(`${base}/issues`, { headers, timeout: 15000 });
      return { output: response.data };
    }
    if (action === 'createIssue') {
      const response = await axios.post(
        `${base}/issues`,
        { title: params.title, body: params.body },
        { headers, timeout: 15000 }
      );
      return { output: response.data };
    }
    if (action === 'commentOnIssue') {
      const response = await axios.post(
        `${base}/issues/${params.issueNumber}/comments`,
        { body: params.body },
        { headers, timeout: 15000 }
      );
      return { output: response.data };
    }
    if (action === 'getFile') {
      const response = await axios.get(`${base}/contents/${params.path}`, { headers, timeout: 15000 });
      return { output: response.data };
    }
    throw new Error(`github node: unknown action "${action}"`);
  },
};

/**
 * postgres — runs a parameterized SQL query against an external Postgres
 * database (NOT FlowForge's own DB — this is for workflow data access).
 * credential (type 'postgres'): { connectionString: string }
 * params: { query: string, values?: unknown[] }
 * Connects fresh per execution and closes the connection afterward —
 * simple and safe for workflow-triggered volumes; swap for a pool if you
 * need high-frequency execution.
 */
export const postgresNode: NodePlugin = {
  type: 'postgres',
  async execute({ params, credential }) {
    const connectionString = credential?.connectionString as string;
    if (!connectionString)
      throw new Error('postgres node: requires a "postgres" credential with { "connectionString": "postgresql://..." }');
    const query = String(params.query ?? '');
    if (!query) throw new Error('postgres node: "query" param is required');

    const client = new PgClient({ connectionString });
    await client.connect();
    try {
      const result = await client.query(query, (params.values as unknown[]) ?? []);
      return { output: { rows: result.rows, rowCount: result.rowCount } };
    } finally {
      await client.end();
    }
  },
};

registerNode(discordNode);
registerNode(telegramNode);
registerNode(notionNode);
registerNode(githubNode);
registerNode(postgresNode);
