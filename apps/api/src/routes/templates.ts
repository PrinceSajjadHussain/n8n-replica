import { Router } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { createWorkflow } from '../db/workflows';
import type { WorkflowGraph } from '@flowforge/shared-types';

/** Mounted at /templates. A small built-in set of starter workflows so new
 *  users have something to instantiate and explore rather than a blank
 *  canvas — the "workflow template gallery" from the UI-polish checklist.
 *  Kept as static data (not DB-backed) since these ship with the product;
 *  workspaces can still save their own workflows as reusable copies via
 *  the normal duplicate flow. */
export const templatesRouter = Router();
templatesRouter.use(requireAuth);

type Difficulty = 'beginner' | 'intermediate' | 'advanced';

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  graph: WorkflowGraph;
  difficulty: Difficulty;
  estimatedSetupMinutes: number;
  /** Seed count so the gallery doesn't launch looking empty; incremented in-memory on every real "Use". */
  usageCount: number;
}

/** Node types that need a credential attached, mirroring the client's
 *  NODE_TYPE_TO_CREDENTIAL_TYPE (apps/web/src/lib/credentialSchemas.ts) —
 *  duplicated here (small + stable) rather than importing across the
 *  web/api boundary, purely to derive each template's "Needs: …" chips. */
const CREDENTIAL_TYPE_BY_NODE_TYPE: Record<string, string> = {
  slack: 'Slack',
  discord: 'Discord',
  telegram: 'Telegram',
  notion: 'Notion',
  github: 'GitHub',
  postgres: 'Postgres',
  httpRequest: 'HTTP Bearer',
  email: 'Email',
  googleSheets: 'Google Sheets',
  openai: 'OpenAI',
  ragIngest: 'OpenAI',
  ragQuery: 'OpenAI',
  agent: 'OpenAI',
  agentMemory: 'OpenAI',
  agentOrchestrator: 'OpenAI',
};

// Templates are listed oldest-first; array index doubles as a stable "added
// order" so the gallery's "Newest" sort has something real to sort by
// without needing a persisted createdAt for static, code-shipped data.
const TEMPLATES: Template[] = [
  {
    id: 'webhook-to-slack',
    name: 'Webhook → Slack notification',
    description: 'Receives a webhook and posts a formatted message to a Slack channel.',
    category: 'Notifications',
    difficulty: 'beginner',
    estimatedSetupMinutes: 5,
    usageCount: 4218,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'Webhook', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'slack', label: 'Post to Slack', position: { x: 260, y: 0 }, params: {} },
      ],
      edges: [{ id: 'e1', source: 't1', target: 't2' }],
    },
  },
  {
    id: 'scheduled-report',
    name: 'Scheduled data pull + email report',
    description: 'Runs on a schedule, calls an API, and emails the result.',
    category: 'Scheduling',
    difficulty: 'beginner',
    estimatedSetupMinutes: 10,
    usageCount: 2984,
    graph: {
      nodes: [
        { id: 't1', type: 'schedule', label: 'Every day at 9am', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'httpRequest', label: 'Fetch data', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'email', label: 'Send report', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
      ],
    },
  },
  {
    id: 'ai-triage',
    name: 'AI ticket triage',
    description: 'Classifies an incoming support ticket with OpenAI and routes it with an IF branch.',
    category: 'AI',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 15,
    usageCount: 6710,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'New ticket', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'openai', label: 'Classify urgency', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'if', label: 'Is urgent?', position: { x: 520, y: 0 }, params: {} },
        { id: 't4', type: 'slack', label: 'Page on-call', position: { x: 780, y: -80 }, params: {} },
        { id: 't5', type: 'set', label: 'Queue normally', position: { x: 780, y: 80 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't3', target: 't4', sourceHandle: 'true' },
        { id: 'e4', source: 't3', target: 't5', sourceHandle: 'false' },
      ],
    },
  },
  {
    id: 'form-to-sheet',
    name: 'Form submission → Google Sheets',
    description: 'Appends every webhook submission as a new row in a spreadsheet.',
    category: 'Data',
    difficulty: 'beginner',
    estimatedSetupMinutes: 8,
    usageCount: 1532,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'Form submitted', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'set', label: 'Shape row', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'googleSheets', label: 'Append row', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
      ],
    },
  },
  {
    id: 'github-pr-to-discord',
    name: 'GitHub PR opened → Discord alert',
    description: 'Notifies a Discord channel whenever a pull request is opened on a watched repo.',
    category: 'Dev',
    difficulty: 'beginner',
    estimatedSetupMinutes: 5,
    usageCount: 3305,
    graph: {
      nodes: [
        { id: 't1', type: 'github', label: 'PR opened', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'discord', label: 'Post to #dev', position: { x: 260, y: 0 }, params: {} },
      ],
      edges: [{ id: 'e1', source: 't1', target: 't2' }],
    },
  },
  {
    id: 'rag-support-agent',
    name: 'RAG-powered support agent',
    description: 'Answers incoming questions from a Telegram bot using a RAG query over your knowledge base.',
    category: 'AI',
    difficulty: 'advanced',
    estimatedSetupMinutes: 25,
    usageCount: 1897,
    graph: {
      nodes: [
        { id: 't1', type: 'telegram', label: 'New message', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'ragQuery', label: 'Query knowledge base', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'openai', label: 'Draft reply', position: { x: 520, y: 0 }, params: {} },
        { id: 't4', type: 'telegram', label: 'Send reply', position: { x: 780, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't3', target: 't4' },
      ],
    },
  },

  // --- CRM/Sales -----------------------------------------------------
  {
    id: 'crm-new-lead-enrich',
    name: 'New lead → enrich → Sheets + Slack alert',
    description: 'Captures a new lead from a webhook, enriches it via an HTTP lookup, logs it to Google Sheets, and pings sales on Slack.',
    category: 'CRM/Sales',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 15,
    usageCount: 2140,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'New lead', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'httpRequest', label: 'Enrich lead', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'googleSheets', label: 'Upsert row', position: { x: 520, y: -60 }, params: {} },
        { id: 't4', type: 'slack', label: 'Notify sales', position: { x: 520, y: 60 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't2', target: 't4' },
      ],
    },
  },
  {
    id: 'crm-deal-won-notion',
    name: 'Deal won → Notion record + thank-you email',
    description: 'When a deal closes, creates a Notion record for handoff and emails the customer a thank-you note.',
    category: 'CRM/Sales',
    difficulty: 'beginner',
    estimatedSetupMinutes: 10,
    usageCount: 986,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'Deal won', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'notion', label: 'Create handoff record', position: { x: 260, y: -50 }, params: {} },
        { id: 't3', type: 'email', label: 'Send thank-you', position: { x: 260, y: 50 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't1', target: 't3' },
      ],
    },
  },

  // --- DevOps ----------------------------------------------------------
  {
    id: 'devops-pr-merged-audit',
    name: 'PR merged → Postgres audit log → Discord',
    description: 'Logs every merged pull request to a Postgres audit table and notifies the team channel.',
    category: 'DevOps',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 15,
    usageCount: 1420,
    graph: {
      nodes: [
        { id: 't1', type: 'github', label: 'PR merged', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'postgres', label: 'Insert audit row', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'discord', label: 'Notify #devops', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
      ],
    },
  },
  {
    id: 'devops-ci-failure-page',
    name: 'CI failure → page on-call',
    description: 'A failed build webhook triggers an IF check on severity and pages on-call via Slack for anything critical.',
    category: 'DevOps',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 12,
    usageCount: 1035,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'CI build failed', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'if', label: 'Is critical branch?', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'slack', label: 'Page on-call', position: { x: 520, y: -60 }, params: {} },
        { id: 't4', type: 'set', label: 'Log only', position: { x: 520, y: 60 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3', sourceHandle: 'true' },
        { id: 'e3', source: 't2', target: 't4', sourceHandle: 'false' },
      ],
    },
  },

  // --- Support -----------------------------------------------------------
  {
    id: 'support-email-triage-notion',
    name: 'Incoming email → AI summary → Notion ticket',
    description: 'Summarizes and classifies an incoming support email with OpenAI, then branches to create a Notion ticket only when it needs follow-up.',
    category: 'Support',
    difficulty: 'advanced',
    estimatedSetupMinutes: 20,
    usageCount: 1710,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'Email received', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'openai', label: 'Classify + summarize', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'if', label: 'Needs follow-up?', position: { x: 520, y: 0 }, params: {} },
        { id: 't4', type: 'notion', label: 'Create ticket', position: { x: 780, y: -60 }, params: {} },
        { id: 't5', type: 'set', label: 'Auto-archive', position: { x: 780, y: 60 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't3', target: 't4', sourceHandle: 'true' },
        { id: 'e4', source: 't3', target: 't5', sourceHandle: 'false' },
      ],
    },
  },
  {
    id: 'support-csat-followup',
    name: 'Low CSAT → Slack alert + follow-up email',
    description: 'Watches a webhook for low satisfaction survey scores and alerts the team while queuing a personal follow-up.',
    category: 'Support',
    difficulty: 'beginner',
    estimatedSetupMinutes: 8,
    usageCount: 640,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'Survey submitted', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'if', label: 'Score < 3?', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'slack', label: 'Alert CS lead', position: { x: 520, y: -60 }, params: {} },
        { id: 't4', type: 'email', label: 'Send follow-up', position: { x: 520, y: 60 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3', sourceHandle: 'true' },
        { id: 'e3', source: 't2', target: 't4', sourceHandle: 'true' },
      ],
    },
  },

  // --- E-commerce ----------------------------------------------------
  {
    id: 'ecommerce-low-stock-alert',
    name: 'Scheduled inventory check → low-stock alert',
    description: 'Polls an inventory API on a schedule and fires Slack + email alerts whenever stock drops below threshold.',
    category: 'E-commerce',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 15,
    usageCount: 1288,
    graph: {
      nodes: [
        { id: 't1', type: 'schedule', label: 'Every hour', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'httpRequest', label: 'Check inventory', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'if', label: 'Low stock?', position: { x: 520, y: 0 }, params: {} },
        { id: 't4', type: 'slack', label: 'Alert warehouse', position: { x: 780, y: -60 }, params: {} },
        { id: 't5', type: 'email', label: 'Email buyer team', position: { x: 780, y: 60 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't3', target: 't4', sourceHandle: 'true' },
        { id: 'e4', source: 't3', target: 't5', sourceHandle: 'true' },
      ],
    },
  },
  {
    id: 'ecommerce-order-to-sheet',
    name: 'New order webhook → Sheets ledger',
    description: 'Appends every incoming order to a running Google Sheets ledger for lightweight bookkeeping.',
    category: 'E-commerce',
    difficulty: 'beginner',
    estimatedSetupMinutes: 8,
    usageCount: 754,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'Order placed', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'set', label: 'Shape order row', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'googleSheets', label: 'Append to ledger', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
      ],
    },
  },

  // --- Content / Marketing ------------------------------------------
  {
    id: 'content-rss-summarize-post',
    name: 'RSS/schedule → AI summary → post to Slack + Discord',
    description: 'Picks up new content on a schedule, summarizes it with OpenAI, and cross-posts to both Slack and Discord.',
    category: 'Content',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 15,
    usageCount: 1063,
    graph: {
      nodes: [
        { id: 't1', type: 'schedule', label: 'Every morning', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'httpRequest', label: 'Fetch RSS feed', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'openai', label: 'Summarize', position: { x: 520, y: 0 }, params: {} },
        { id: 't4', type: 'slack', label: 'Post to #content', position: { x: 780, y: -60 }, params: {} },
        { id: 't5', type: 'discord', label: 'Post to Discord', position: { x: 780, y: 60 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't3', target: 't4' },
        { id: 'e4', source: 't3', target: 't5' },
      ],
    },
  },
  {
    id: 'content-approval-then-publish',
    name: 'Draft ready → human approval → publish notice',
    description: 'Holds a drafted post for human approval before announcing it, so nothing goes out unreviewed.',
    category: 'Content',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 12,
    usageCount: 512,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'Draft ready', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'humanApproval', label: 'Review draft', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'slack', label: 'Announce published', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
      ],
    },
  },

  // --- Data ops --------------------------------------------------------
  {
    id: 'dataops-csv-upsert-error-branch',
    name: 'CSV file-watcher → Data Table upsert (with error branch)',
    description: 'Extracts rows from a watched CSV file, upserts them into a Data Table, and routes any failures to Slack for triage.',
    category: 'Data Ops',
    difficulty: 'advanced',
    estimatedSetupMinutes: 20,
    usageCount: 833,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'File uploaded', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'fileExtract', label: 'Extract CSV rows', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'dataTableWrite', label: 'Upsert rows', position: { x: 520, y: 0 }, params: {}, continueOnFail: true },
        { id: 't4', type: 'slack', label: 'Alert on failed rows', position: { x: 780, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't3', target: 't4' },
      ],
    },
  },
  {
    id: 'dataops-postgres-to-sheets-sync',
    name: 'Scheduled Postgres → Google Sheets sync',
    description: 'Pulls a query result from Postgres on a schedule and mirrors it into a Google Sheet for non-technical stakeholders.',
    category: 'Data Ops',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 15,
    usageCount: 701,
    graph: {
      nodes: [
        { id: 't1', type: 'schedule', label: 'Every night', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'postgres', label: 'Run report query', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'code', label: 'Reshape rows', position: { x: 520, y: 0 }, params: {} },
        { id: 't4', type: 'googleSheets', label: 'Overwrite sheet', position: { x: 780, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't3', target: 't4' },
      ],
    },
  },

  // --- Agent -------------------------------------------------------------
  {
    id: 'agent-telegram-tools-memory',
    name: 'Telegram → AI Agent (Slack + HTTP tools, with memory)',
    description: 'A Telegram-triggered AI Agent that can call a Slack tool and an HTTP tool, remembering prior turns via Agent Memory.',
    category: 'Agent',
    difficulty: 'advanced',
    estimatedSetupMinutes: 25,
    usageCount: 947,
    graph: {
      nodes: [
        { id: 't1', type: 'telegram', label: 'Question asked', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'agentMemory', label: 'Recall context', position: { x: 260, y: -60 }, params: {} },
        { id: 't3', type: 'agent', label: 'AI Agent', position: { x: 260, y: 60 }, params: { tools: ['slack', 'httpRequest'] } },
        { id: 't4', type: 'telegram', label: 'Send answer', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't1', target: 't3' },
        { id: 'e3', source: 't2', target: 't3' },
        { id: 'e4', source: 't3', target: 't4' },
      ],
    },
  },
  {
    id: 'agent-multi-orchestrator-research',
    name: 'Multi-agent research orchestrator',
    description: 'Fans a research question out to a small team of specialized agents and merges their findings into one reply.',
    category: 'Agent',
    difficulty: 'advanced',
    estimatedSetupMinutes: 30,
    usageCount: 421,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'Research request', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'agentOrchestrator', label: 'Orchestrator', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'merge', label: 'Merge findings', position: { x: 520, y: 0 }, params: {} },
        { id: 't4', type: 'respondToWebhook', label: 'Respond', position: { x: 780, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't3', target: 't4' },
      ],
    },
  },

  // --- RAG -----------------------------------------------------------
  {
    id: 'rag-ingest-query-citations',
    name: 'RAG Ingest (website/PDF) → RAG Query with citations',
    description: 'Ingests a website or PDF into your vector store, then answers webhook questions against it with source citations.',
    category: 'RAG',
    difficulty: 'advanced',
    estimatedSetupMinutes: 25,
    usageCount: 1156,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'Source added', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'ragIngest', label: 'Ingest website/PDF', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'webhook', label: 'Question asked', position: { x: 0, y: 140 }, params: {} },
        { id: 't4', type: 'ragQuery', label: 'Query with citations', position: { x: 260, y: 140 }, params: {} },
        { id: 't5', type: 'respondToWebhook', label: 'Return answer', position: { x: 520, y: 140 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't3', target: 't4' },
        { id: 'e3', source: 't4', target: 't5' },
      ],
    },
  },
  {
    id: 'rag-slack-knowledge-bot',
    name: 'Slack question → RAG lookup → threaded answer',
    description: 'Answers questions posted in Slack by querying your ingested knowledge base and replying in-thread.',
    category: 'RAG',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 18,
    usageCount: 688,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'Slack mention', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'ragQuery', label: 'Query knowledge base', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'slack', label: 'Reply in thread', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
      ],
    },
  },

  // --- More AI (rounding "AI" out to 4+) --------------------------------
  {
    id: 'ai-content-moderation',
    name: 'AI content moderation flag',
    description: 'Screens incoming user-generated content with OpenAI and routes anything flagged straight to a moderator on Slack.',
    category: 'AI',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 12,
    usageCount: 1204,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'Content submitted', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'openai', label: 'Moderate content', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'if', label: 'Flagged?', position: { x: 520, y: 0 }, params: {} },
        { id: 't4', type: 'slack', label: 'Send to moderator', position: { x: 780, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't3', target: 't4', sourceHandle: 'true' },
      ],
    },
  },
  {
    id: 'ai-meeting-notes-summarizer',
    name: 'Meeting notes → AI summary → Notion',
    description: 'Summarizes a raw meeting transcript with OpenAI and files the summary as a Notion page.',
    category: 'AI',
    difficulty: 'beginner',
    estimatedSetupMinutes: 10,
    usageCount: 890,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'Transcript uploaded', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'openai', label: 'Summarize notes', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'notion', label: 'File summary', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
      ],
    },
  },

  // --- More Data (rounding "Data" out to 4+) ----------------------------
  {
    id: 'data-file-extract-transform-sheet',
    name: 'Extract from File → transform → Sheets',
    description: 'Pulls structured rows out of an uploaded file, reshapes them with Set, and writes them into a spreadsheet.',
    category: 'Data',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 12,
    usageCount: 665,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'File uploaded', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'fileExtract', label: 'Extract rows', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'set', label: 'Reshape fields', position: { x: 520, y: 0 }, params: {} },
        { id: 't4', type: 'googleSheets', label: 'Write rows', position: { x: 780, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't3', target: 't4' },
      ],
    },
  },
  {
    id: 'data-dedupe-merge-datatable',
    name: 'Dedupe + merge into Data Table',
    description: 'Merges two incoming record sources and writes the deduplicated result into a shared Data Table.',
    category: 'Data',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 14,
    usageCount: 412,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'Source A', position: { x: 0, y: -60 }, params: {} },
        { id: 't2', type: 'webhook', label: 'Source B', position: { x: 0, y: 60 }, params: {} },
        { id: 't3', type: 'merge', label: 'Merge + dedupe', position: { x: 260, y: 0 }, params: {} },
        { id: 't4', type: 'dataTableWrite', label: 'Write to table', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't3' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't3', target: 't4' },
      ],
    },
  },

  // --- More Dev (rounding "Dev" out to 4+) -------------------------------
  {
    id: 'dev-ci-code-respond',
    name: 'Webhook → Code transform → respond',
    description: 'A lightweight internal API endpoint: validates and transforms the payload in a Code node, then responds synchronously.',
    category: 'Dev',
    difficulty: 'beginner',
    estimatedSetupMinutes: 8,
    usageCount: 588,
    graph: {
      nodes: [
        { id: 't1', type: 'waitForWebhook', label: 'Await request', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'code', label: 'Validate + transform', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'respondToWebhook', label: 'Respond', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
      ],
    },
  },
  {
    id: 'dev-nightly-subworkflow-run',
    name: 'Nightly sub-workflow batch runner',
    description: 'On a schedule, waits briefly for rate-limit headroom then kicks off a shared sub-workflow for batch processing.',
    category: 'Dev',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 12,
    usageCount: 349,
    graph: {
      nodes: [
        { id: 't1', type: 'schedule', label: 'Every night at 2am', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'wait', label: 'Stagger start', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'subWorkflow', label: 'Run batch job', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
      ],
    },
  },

  // --- More Notifications (rounding out to 4+) --------------------------
  {
    id: 'notifications-daily-digest',
    name: 'Scheduled daily digest → email + Slack',
    description: 'Builds a daily summary on a schedule and delivers it over both email and Slack.',
    category: 'Notifications',
    difficulty: 'beginner',
    estimatedSetupMinutes: 8,
    usageCount: 823,
    graph: {
      nodes: [
        { id: 't1', type: 'schedule', label: 'Every day at 6pm', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'set', label: 'Build digest', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'email', label: 'Email digest', position: { x: 520, y: -60 }, params: {} },
        { id: 't4', type: 'slack', label: 'Post digest', position: { x: 520, y: 60 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't2', target: 't4' },
      ],
    },
  },
  {
    id: 'notifications-approval-then-notify',
    name: 'Request → human approval → multi-channel notify',
    description: 'Routes a request through human approval, then fans the outcome out to Slack and Discord simultaneously.',
    category: 'Notifications',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 12,
    usageCount: 401,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'Request submitted', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'humanApproval', label: 'Awaiting approval', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'slack', label: 'Notify #ops', position: { x: 520, y: -60 }, params: {} },
        { id: 't4', type: 'discord', label: 'Notify #general', position: { x: 520, y: 60 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't2', target: 't4' },
      ],
    },
  },

  // --- More Scheduling (rounding out to 4+) -----------------------------
  {
    id: 'scheduling-nightly-postgres-backup-check',
    name: 'Nightly Postgres health check',
    description: 'Runs a nightly query against Postgres and only alerts the team when something looks wrong.',
    category: 'Scheduling',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 12,
    usageCount: 512,
    graph: {
      nodes: [
        { id: 't1', type: 'schedule', label: 'Every night at 3am', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'postgres', label: 'Run health check', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'if', label: 'Anomaly found?', position: { x: 520, y: 0 }, params: {} },
        { id: 't4', type: 'slack', label: 'Alert on-call', position: { x: 780, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't3', target: 't4', sourceHandle: 'true' },
      ],
    },
  },
  {
    id: 'scheduling-delayed-followup',
    name: 'Delay → follow-up reminder email',
    description: 'Waits a configurable period after a trigger event, then sends a follow-up reminder if nothing else has happened.',
    category: 'Scheduling',
    difficulty: 'beginner',
    estimatedSetupMinutes: 6,
    usageCount: 379,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'Trial started', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'wait', label: 'Wait 3 days', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'email', label: 'Send reminder', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
      ],
    },
  },
  {
    id: 'scheduling-weekly-team-digest',
    name: 'Weekly team digest → Notion page',
    description: 'Rolls up the week\'s activity on a schedule and files it as a fresh Notion page for the team to skim.',
    category: 'Scheduling',
    difficulty: 'beginner',
    estimatedSetupMinutes: 8,
    usageCount: 296,
    graph: {
      nodes: [
        { id: 't1', type: 'schedule', label: 'Every Friday 4pm', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'set', label: 'Assemble digest', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'notion', label: 'Publish page', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
      ],
    },
  },
  {
    id: 'data-postgres-webhook-lookup',
    name: 'Webhook lookup → Postgres query → respond',
    description: 'A synchronous lookup endpoint: waits for the request, queries Postgres, and responds with the result inline.',
    category: 'Data',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 12,
    usageCount: 468,
    graph: {
      nodes: [
        { id: 't1', type: 'waitForWebhook', label: 'Await lookup request', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'postgres', label: 'Query record', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'respondToWebhook', label: 'Return result', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
      ],
    },
  },
  {
    id: 'dev-forEach-batch-github-issues',
    name: 'For Each → create a GitHub issue per item',
    description: 'Loops over a batch of incoming items and files a GitHub issue for each one that needs engineering follow-up.',
    category: 'Dev',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 14,
    usageCount: 305,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'Batch received', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'forEach', label: 'For each item', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'forEachBranch', label: 'Per-item branch', position: { x: 520, y: 0 }, params: {} },
        { id: 't4', type: 'github', label: 'Create issue', position: { x: 780, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't3', target: 't4' },
      ],
    },
  },
  {
    id: 'notifications-convert-to-file-attach',
    name: 'Convert to File → email as attachment',
    description: 'Converts a generated report into a file and emails it as an attachment instead of pasting it inline.',
    category: 'Notifications',
    difficulty: 'beginner',
    estimatedSetupMinutes: 8,
    usageCount: 274,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'Report ready', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'fileConvert', label: 'Convert to PDF', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'email', label: 'Email attachment', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
      ],
    },
  },
  {
    id: 'marketing-new-subscriber-welcome',
    name: 'New subscriber → welcome sequence',
    description: 'Tags a new mailing-list subscriber and kicks off a personalized welcome email via HTTP request to the ESP.',
    category: 'Marketing',
    difficulty: 'beginner',
    estimatedSetupMinutes: 10,
    usageCount: 512,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'New subscriber', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'set', label: 'Build welcome payload', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'httpRequest', label: 'Send via ESP API', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
      ],
    },
  },
  {
    id: 'marketing-social-post-approval',
    name: 'Social post draft → human approval → publish',
    description: 'Drafts a social post with AI, waits for a marketer to approve, then posts it — a lightweight content-review loop.',
    category: 'Marketing',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 15,
    usageCount: 201,
    graph: {
      nodes: [
        { id: 't1', type: 'schedule', label: 'Weekly content slot', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'openai', label: 'Draft post copy', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'humanApproval', label: 'Marketer review', position: { x: 520, y: 0 }, params: {} },
        { id: 't4', type: 'httpRequest', label: 'Publish', position: { x: 780, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't3', target: 't4' },
      ],
    },
  },
  {
    id: 'hr-new-hire-onboarding',
    name: 'New hire → onboarding checklist',
    description: 'On a new-hire webhook, creates onboarding tasks in Notion and notifies the hiring manager on Slack.',
    category: 'HR',
    difficulty: 'beginner',
    estimatedSetupMinutes: 12,
    usageCount: 168,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'New hire recorded', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'notion', label: 'Create onboarding board', position: { x: 260, y: -50 }, params: {} },
        { id: 't3', type: 'slack', label: 'Notify manager', position: { x: 260, y: 50 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't1', target: 't3' },
      ],
    },
  },
  {
    id: 'hr-timeoff-request-routing',
    name: 'Time-off request → manager approval',
    description: 'Routes a submitted time-off request to the requester\'s manager for approval before it is logged.',
    category: 'HR',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 14,
    usageCount: 97,
    graph: {
      nodes: [
        { id: 't1', type: 'webhook', label: 'Time-off requested', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'humanApproval', label: 'Manager approval', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'if', label: 'Approved?', position: { x: 520, y: 0 }, params: {} },
        { id: 't4', type: 'postgres', label: 'Log approved leave', position: { x: 780, y: -60 }, params: {} },
        { id: 't5', type: 'slack', label: 'Notify denial', position: { x: 780, y: 60 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't3', target: 't4', sourceHandle: 'true' },
        { id: 'e4', source: 't3', target: 't5', sourceHandle: 'false' },
      ],
    },
  },
  {
    id: 'finance-invoice-paid-reconcile',
    name: 'Stripe invoice paid → reconcile + notify finance',
    description: 'Listens for a paid invoice and writes a reconciliation row to Postgres, then pings the finance channel.',
    category: 'Finance',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 13,
    usageCount: 233,
    graph: {
      nodes: [
        { id: 't1', type: 'stripe', label: 'Invoice paid', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'postgres', label: 'Insert reconciliation row', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'slack', label: 'Notify #finance', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
      ],
    },
  },
  {
    id: 'finance-failed-payment-dunning',
    name: 'Failed payment → dunning email',
    description: 'On a failed Stripe charge, sends a payment-retry email to the customer and logs the attempt.',
    category: 'Finance',
    difficulty: 'beginner',
    estimatedSetupMinutes: 9,
    usageCount: 178,
    graph: {
      nodes: [
        { id: 't1', type: 'stripe', label: 'Charge failed', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'email', label: 'Send dunning email', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'postgres', label: 'Log attempt', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
      ],
    },
  },
  {
    id: 'security-failed-login-alert',
    name: 'Repeated failed logins → security alert',
    description: 'Watches an auth-event stream and pages the security channel when failures exceed a threshold.',
    category: 'Security',
    difficulty: 'advanced',
    estimatedSetupMinutes: 20,
    usageCount: 84,
    graph: {
      nodes: [
        { id: 't1', type: 'streamTrigger', label: 'Auth events stream', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'code', label: 'Count recent failures', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'if', label: 'Over threshold?', position: { x: 520, y: 0 }, params: {} },
        { id: 't4', type: 'slack', label: 'Page security', position: { x: 780, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't3', target: 't4', sourceHandle: 'true' },
      ],
    },
  },
  {
    id: 'security-secret-rotation-reminder',
    name: 'Scheduled secret rotation reminder',
    description: 'A recurring schedule that reminds the on-call engineer to rotate API keys and logs each reminder.',
    category: 'Security',
    difficulty: 'beginner',
    estimatedSetupMinutes: 6,
    usageCount: 61,
    graph: {
      nodes: [
        { id: 't1', type: 'schedule', label: 'Every 90 days', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'slack', label: 'Remind on-call', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'postgres', label: 'Log reminder sent', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
      ],
    },
  },
  {
    id: 'productivity-daily-standup-digest',
    name: 'Daily standup digest from Slack threads',
    description: 'Every morning, collects yesterday\'s standup thread replies and posts a summarized digest.',
    category: 'Productivity',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 16,
    usageCount: 143,
    graph: {
      nodes: [
        { id: 't1', type: 'schedule', label: 'Every weekday 8am', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'slack', label: 'Fetch thread replies', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'openai', label: 'Summarize updates', position: { x: 520, y: 0 }, params: {} },
        { id: 't4', type: 'slack', label: 'Post digest', position: { x: 780, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't3', target: 't4' },
      ],
    },
  },
  {
    id: 'productivity-meeting-notes-to-tasks',
    name: 'Meeting notes → action items in Notion',
    description: 'Extracts action items from uploaded meeting notes with AI and creates a task per item in Notion.',
    category: 'Productivity',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 15,
    usageCount: 176,
    graph: {
      nodes: [
        { id: 't1', type: 'fileWatcher', label: 'Notes file added', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'fileExtract', label: 'Extract text', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'openai', label: 'Extract action items', position: { x: 520, y: 0 }, params: {} },
        { id: 't4', type: 'forEach', label: 'For each item', position: { x: 780, y: 0 }, params: {} },
        { id: 't5', type: 'notion', label: 'Create task', position: { x: 1040, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
        { id: 'e3', source: 't3', target: 't4' },
        { id: 'e4', source: 't4', target: 't5' },
      ],
    },
  },
  {
    id: 'iot-sensor-threshold-alert',
    name: 'IoT sensor reading → threshold alert',
    description: 'Consumes sensor readings from a Kafka topic and alerts when a value crosses a configured threshold.',
    category: 'IoT',
    difficulty: 'advanced',
    estimatedSetupMinutes: 22,
    usageCount: 47,
    graph: {
      nodes: [
        { id: 't1', type: 'streamTrigger', label: 'Sensor readings (Kafka)', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'if', label: 'Over threshold?', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'twilio', label: 'SMS on-call', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3', sourceHandle: 'true' },
      ],
    },
  },
  {
    id: 'ecommerce-abandoned-cart-followup',
    name: 'Abandoned cart → recovery email',
    description: 'When a Shopify cart is abandoned for a while, waits, then sends a personalized recovery email.',
    category: 'E-commerce',
    difficulty: 'intermediate',
    estimatedSetupMinutes: 14,
    usageCount: 289,
    graph: {
      nodes: [
        { id: 't1', type: 'shopify', label: 'Cart abandoned', position: { x: 0, y: 0 }, params: {} },
        { id: 't2', type: 'wait', label: 'Wait 2 hours', position: { x: 260, y: 0 }, params: {} },
        { id: 't3', type: 'email', label: 'Send recovery email', position: { x: 520, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 't2' },
        { id: 'e2', source: 't2', target: 't3' },
      ],
    },
  },
];

/** Distinct node "app" types in a template's graph, in graph order — drives the
 *  app-icon-pair chips on each gallery card (Make-style). */
function appTypesOf(template: Template): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const node of template.graph.nodes) {
    if (!seen.has(node.type)) {
      seen.add(node.type);
      ordered.push(node.type);
    }
  }
  return ordered;
}

function requiredCredentialTypesOf(template: Template): string[] {
  const labels = new Set<string>();
  for (const type of appTypesOf(template)) {
    const label = CREDENTIAL_TYPE_BY_NODE_TYPE[type];
    if (label) labels.add(label);
  }
  return Array.from(labels);
}

function toSummary(t: Template, order: number) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    usageCount: t.usageCount,
    appTypes: appTypesOf(t),
    difficulty: t.difficulty,
    estimatedSetupMinutes: t.estimatedSetupMinutes,
    requiredCredentialTypes: requiredCredentialTypesOf(t),
    order,
    // Included so the gallery card can render an inline SVG graph-preview
    // thumbnail client-side (boxes + arrows from real node positions) with
    // no separate screenshot/asset pipeline.
    nodes: t.graph.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position })),
    edges: t.graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null })),
  };
}

/** GET /templates — the gallery listing. */
templatesRouter.get('/', (_req, res) => {
  res.json({ templates: TEMPLATES.map((t, i) => toSummary(t, i)) });
});

const instantiateSchema = z.object({ workspaceId: z.string().uuid().nullable().optional(), name: z.string().min(1).optional() });

/** POST /templates/:id/use — creates a new workflow from a template. */
templatesRouter.post('/:id/use', async (req: AuthedRequest, res, next) => {
  try {
    const template = TEMPLATES.find((t) => t.id === req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const parsed = instantiateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const workflow = await createWorkflow(
      req.userId!,
      parsed.data.name ?? template.name,
      template.graph.nodes,
      template.graph.edges,
      parsed.data.workspaceId ?? null
    );
    template.usageCount += 1;
    res.status(201).json({ workflow });
  } catch (err) {
    next(err);
  }
});
