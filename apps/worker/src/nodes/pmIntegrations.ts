import axios from 'axios';
import { registerNode } from './types';
import type { NodePlugin } from './types';
import { wrapIntegrationError } from './integrationErrors';
import { rlValue } from './resourceLocatorValue';

/**
 * trello — REST API wrapper over Trello's Cards/Boards/Lists endpoints.
 * credential (type 'trello'): { apiKey: string, token: string }
 * params:
 *   action: 'createCard' | 'getCard' | 'updateCard' | 'listCardsOnBoard' | 'addComment'
 *   boardId?, listId?, cardId?, name?, desc?, text? (addComment)
 * Failure modes: 401 (bad key/token), 429 (rate limit ~300 req/10s per key), timeout.
 */
export const trelloNode: NodePlugin = {
  type: 'trello',
  async execute({ params, credential }) {
    const apiKey = credential?.apiKey as string;
    const token = credential?.token as string;
    if (!apiKey || !token) throw new Error('trello node: requires a "trello" credential with { "apiKey", "token" }');
    const auth = { key: apiKey, token };
    const action = String(params.action ?? 'createCard');
    try {
      if (action === 'createCard') {
        const response = await axios.post('https://api.trello.com/1/cards', null, {
          params: { ...auth, idList: rlValue(params.listId), name: params.name, desc: params.desc },
          timeout: 15000,
        });
        return { output: response.data };
      }
      if (action === 'getCard') {
        const response = await axios.get(`https://api.trello.com/1/cards/${params.cardId}`, { params: auth, timeout: 15000 });
        return { output: response.data };
      }
      if (action === 'updateCard') {
        const response = await axios.put(`https://api.trello.com/1/cards/${params.cardId}`, null, {
          params: { ...auth, name: params.name, desc: params.desc },
          timeout: 15000,
        });
        return { output: response.data };
      }
      if (action === 'listCardsOnBoard') {
        const response = await axios.get(`https://api.trello.com/1/boards/${rlValue(params.boardId)}/cards`, {
          params: auth,
          timeout: 15000,
        });
        return { output: response.data };
      }
      if (action === 'addComment') {
        const response = await axios.post(`https://api.trello.com/1/cards/${params.cardId}/actions/comments`, null, {
          params: { ...auth, text: params.text },
          timeout: 15000,
        });
        return { output: response.data };
      }
      throw new Error(`trello node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('trello', err);
    }
  },
};

/**
 * asana — REST API wrapper over Tasks/Projects.
 * credential (type 'asana'): { accessToken: string } (personal access token or OAuth token)
 * params:
 *   action: 'createTask' | 'getTask' | 'updateTask' | 'listTasksInProject' | 'addComment'
 *   projectId?, taskId?, name?, notes?, text? (addComment), completed?
 */
export const asanaNode: NodePlugin = {
  type: 'asana',
  async execute({ params, credential }) {
    const accessToken = credential?.accessToken as string;
    if (!accessToken) throw new Error('asana node: requires an "asana" credential with { "accessToken": "..." }');
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
    const base = 'https://app.asana.com/api/1.0';
    const action = String(params.action ?? 'createTask');
    try {
      if (action === 'createTask') {
        const response = await axios.post(
          `${base}/tasks`,
          { data: { name: params.name, notes: params.notes, projects: params.projectId ? [rlValue(params.projectId)] : [] } },
          { headers, timeout: 15000 }
        );
        return { output: response.data };
      }
      if (action === 'getTask') {
        const response = await axios.get(`${base}/tasks/${params.taskId}`, { headers, timeout: 15000 });
        return { output: response.data };
      }
      if (action === 'updateTask') {
        const response = await axios.put(
          `${base}/tasks/${params.taskId}`,
          { data: { name: params.name, notes: params.notes, completed: params.completed } },
          { headers, timeout: 15000 }
        );
        return { output: response.data };
      }
      if (action === 'listTasksInProject') {
        const response = await axios.get(`${base}/projects/${rlValue(params.projectId)}/tasks`, { headers, timeout: 15000 });
        return { output: response.data };
      }
      if (action === 'addComment') {
        const response = await axios.post(
          `${base}/tasks/${params.taskId}/stories`,
          { data: { text: params.text } },
          { headers, timeout: 15000 }
        );
        return { output: response.data };
      }
      throw new Error(`asana node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('asana', err);
    }
  },
};

/**
 * clickup — REST API wrapper over Tasks.
 * credential (type 'clickup'): { apiToken: string } (personal token, "pk_..." )
 * params:
 *   action: 'createTask' | 'getTask' | 'updateTask' | 'listTasksInList'
 *   listId?, taskId?, name?, description?, status?
 */
export const clickupNode: NodePlugin = {
  type: 'clickup',
  async execute({ params, credential }) {
    const apiToken = credential?.apiToken as string;
    if (!apiToken) throw new Error('clickup node: requires a "clickup" credential with { "apiToken": "pk_..." }');
    const headers = { Authorization: apiToken, 'Content-Type': 'application/json' };
    const base = 'https://api.clickup.com/api/v2';
    const action = String(params.action ?? 'createTask');
    try {
      if (action === 'createTask') {
        const response = await axios.post(
          `${base}/list/${rlValue(params.listId)}/task`,
          { name: params.name, description: params.description, status: params.status },
          { headers, timeout: 15000 }
        );
        return { output: response.data };
      }
      if (action === 'getTask') {
        const response = await axios.get(`${base}/task/${params.taskId}`, { headers, timeout: 15000 });
        return { output: response.data };
      }
      if (action === 'updateTask') {
        const response = await axios.put(
          `${base}/task/${params.taskId}`,
          { name: params.name, description: params.description, status: params.status },
          { headers, timeout: 15000 }
        );
        return { output: response.data };
      }
      if (action === 'listTasksInList') {
        const response = await axios.get(`${base}/list/${rlValue(params.listId)}/task`, { headers, timeout: 15000 });
        return { output: response.data };
      }
      throw new Error(`clickup node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('clickup', err);
    }
  },
};

/**
 * linear — GraphQL API wrapper over Issues.
 * credential (type 'linear'): { apiKey: string } ("lin_api_...")
 * params:
 *   action: 'createIssue' | 'getIssue' | 'updateIssue' | 'listIssues'
 *   teamId? (createIssue), issueId?, title?, description?, stateId?
 */
export const linearNode: NodePlugin = {
  type: 'linear',
  async execute({ params, credential }) {
    const apiKey = credential?.apiKey as string;
    if (!apiKey) throw new Error('linear node: requires a "linear" credential with { "apiKey": "lin_api_..." }');
    const headers = { Authorization: apiKey, 'Content-Type': 'application/json' };
    const action = String(params.action ?? 'createIssue');

    async function gql(query: string, variables: Record<string, unknown>) {
      const response = await axios.post(
        'https://api.linear.app/graphql',
        { query, variables },
        { headers, timeout: 15000 }
      );
      if (response.data?.errors?.length) {
        throw new Error(`linear node: ${response.data.errors.map((e: { message: string }) => e.message).join('; ')}`);
      }
      return response.data.data;
    }

    try {
      if (action === 'createIssue') {
        const data = await gql(
          `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }`,
          { input: { teamId: rlValue(params.teamId), title: params.title, description: params.description } }
        );
        return { output: data.issueCreate };
      }
      if (action === 'getIssue') {
        const data = await gql(`query($id: String!) { issue(id: $id) { id identifier title state { name } url } }`, {
          id: params.issueId,
        });
        return { output: data.issue };
      }
      if (action === 'updateIssue') {
        const data = await gql(
          `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id identifier } } }`,
          { id: params.issueId, input: { title: params.title, description: params.description, stateId: params.stateId } }
        );
        return { output: data.issueUpdate };
      }
      if (action === 'listIssues') {
        const data = await gql(
          `query($teamId: String) { issues(filter: { team: { id: { eq: $teamId } } }, first: 50) { nodes { id identifier title state { name } } } }`,
          { teamId: rlValue(params.teamId) }
        );
        return { output: data.issues.nodes };
      }
      throw new Error(`linear node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('linear', err);
    }
  },
};

/**
 * jira — REST API wrapper over Jira Cloud Issues (Basic auth: email + API token).
 * credential (type 'jira'): { siteUrl: string (e.g. "https://yourorg.atlassian.net"), email: string, apiToken: string }
 * params:
 *   action: 'createIssue' | 'getIssue' | 'updateIssue' | 'searchIssues' | 'addComment'
 *   projectKey?, issueType?, summary?, description?, issueKey?, jql? (searchIssues), text? (addComment)
 */
export const jiraNode: NodePlugin = {
  type: 'jira',
  async execute({ params, credential }) {
    const siteUrl = (credential?.siteUrl as string)?.replace(/\/$/, '');
    const email = credential?.email as string;
    const apiToken = credential?.apiToken as string;
    if (!siteUrl || !email || !apiToken)
      throw new Error('jira node: requires a "jira" credential with { "siteUrl", "email", "apiToken" }');
    const auth = { username: email, password: apiToken };
    const base = `${siteUrl}/rest/api/3`;
    const action = String(params.action ?? 'createIssue');
    try {
      if (action === 'createIssue') {
        const response = await axios.post(
          `${base}/issue`,
          {
            fields: {
              project: { key: rlValue(params.projectKey) },
              summary: params.summary,
              description: {
                type: 'doc',
                version: 1,
                content: [{ type: 'paragraph', content: [{ type: 'text', text: String(params.description ?? '') }] }],
              },
              issuetype: { name: params.issueType ?? 'Task' },
            },
          },
          { auth, timeout: 15000 }
        );
        return { output: response.data };
      }
      if (action === 'getIssue') {
        const response = await axios.get(`${base}/issue/${params.issueKey}`, { auth, timeout: 15000 });
        return { output: response.data };
      }
      if (action === 'updateIssue') {
        await axios.put(
          `${base}/issue/${params.issueKey}`,
          { fields: { summary: params.summary } },
          { auth, timeout: 15000 }
        );
        return { output: { updated: true, key: params.issueKey } };
      }
      if (action === 'searchIssues') {
        const response = await axios.get(`${base}/search`, { auth, params: { jql: params.jql }, timeout: 15000 });
        return { output: response.data };
      }
      if (action === 'addComment') {
        const response = await axios.post(
          `${base}/issue/${params.issueKey}/comment`,
          { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: String(params.text ?? '') }] }] } },
          { auth, timeout: 15000 }
        );
        return { output: response.data };
      }
      throw new Error(`jira node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('jira', err);
    }
  },
};

registerNode(trelloNode);
registerNode(asanaNode);
registerNode(clickupNode);
registerNode(linearNode);
registerNode(jiraNode);
