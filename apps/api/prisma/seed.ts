/**
 * Idempotent seed script.
 *
 *  - Creates 50+ commonly-used instance-wide Variables (workspaceId = NULL),
 *    the kind almost every FlowForge instance ends up hand-typing anyway
 *    (base URLs, timezone, retry/pagination defaults, feature flags, ...).
 *    Referenced in any node expression as {{$vars.KEY}}.
 *  - Creates one "Data Type Showcase" Data Table per existing workspace,
 *    with one column per entry in the 25-type column catalog
 *    (packages/shared-types/src/columnTypes.ts) and a couple of example
 *    rows, so the Data Tables UI is something to look at instead of empty.
 *
 * Run with: npm run seed --workspace=@flowforge/api
 * (wired to `prisma db seed` too, so `prisma migrate dev` runs it automatically)
 */
import { randomUUID } from 'crypto';
import { pool } from '../src/db/pool';
import { COLUMN_TYPES } from '@flowforge/shared-types';

/** 50+ instance-wide defaults covering integration base URLs, auth/retry
 *  knobs, formatting conventions, and feature flags — the variables almost
 *  every workflow author ends up creating by hand in the first week. */
const DEFAULT_VARIABLES: Record<string, string> = {
  // --- Environment / app ---
  APP_ENV: 'production',
  APP_NAME: 'FlowForge',
  APP_URL: 'https://app.flowforge.dev',
  DEFAULT_TIMEZONE: 'Asia/Karachi',
  DEFAULT_LOCALE: 'en-US',
  DEFAULT_CURRENCY: 'USD',
  DATE_FORMAT: 'YYYY-MM-DD',
  DATETIME_FORMAT: 'YYYY-MM-DD HH:mm:ss',
  SUPPORT_EMAIL: 'support@flowforge.dev',
  ADMIN_EMAIL: 'admin@flowforge.dev',

  // --- HTTP / API defaults ---
  DEFAULT_HTTP_TIMEOUT_MS: '30000',
  DEFAULT_RETRY_COUNT: '3',
  DEFAULT_RETRY_BACKOFF_MS: '1000',
  DEFAULT_PAGE_SIZE: '50',
  MAX_PAGE_SIZE: '200',
  RATE_LIMIT_PER_MINUTE: '60',
  USER_AGENT: 'FlowForge-Workflow/1.0',

  // --- Common integration base URLs ---
  SLACK_API_BASE_URL: 'https://slack.com/api',
  DISCORD_API_BASE_URL: 'https://discord.com/api/v10',
  GITHUB_API_BASE_URL: 'https://api.github.com',
  NOTION_API_BASE_URL: 'https://api.notion.com/v1',
  STRIPE_API_BASE_URL: 'https://api.stripe.com/v1',
  OPENAI_API_BASE_URL: 'https://api.openai.com/v1',
  ANTHROPIC_API_BASE_URL: 'https://api.anthropic.com/v1',
  GEMINI_API_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta',
  GOOGLE_SHEETS_API_BASE_URL: 'https://sheets.googleapis.com/v4',
  TELEGRAM_API_BASE_URL: 'https://api.telegram.org',
  TWILIO_API_BASE_URL: 'https://api.twilio.com/2010-04-01',
  SENDGRID_API_BASE_URL: 'https://api.sendgrid.com/v3',
  ZENDESK_API_BASE_URL: 'https://your-domain.zendesk.com/api/v2',
  HUBSPOT_API_BASE_URL: 'https://api.hubapi.com',
  SHOPIFY_API_BASE_URL: 'https://your-store.myshopify.com/admin/api/2024-10',
  AIRTABLE_API_BASE_URL: 'https://api.airtable.com/v0',
  JIRA_API_BASE_URL: 'https://your-domain.atlassian.net/rest/api/3',
  SALESFORCE_API_BASE_URL: 'https://your-instance.salesforce.com/services/data/v60.0',

  // --- Storage / infra ---
  S3_BUCKET_NAME: 'flowforge-attachments',
  S3_REGION: 'us-east-1',
  CDN_BASE_URL: 'https://cdn.flowforge.dev',
  REDIS_KEY_PREFIX: 'flowforge:',
  UPLOADS_MAX_FILE_SIZE_MB: '25',

  // --- Notification routing ---
  ALERTS_SLACK_CHANNEL: '#flowforge-alerts',
  ERROR_NOTIFICATION_EMAIL: 'errors@flowforge.dev',
  ONCALL_DISCORD_WEBHOOK_LABEL: 'oncall-webhook',

  // --- Feature flags ---
  FEATURE_AI_NODES_ENABLED: 'true',
  FEATURE_BROWSER_AUTOMATION_ENABLED: 'true',
  FEATURE_COMMUNITY_NODES_ENABLED: 'true',
  FEATURE_RAG_ENABLED: 'true',
  FEATURE_HUMAN_APPROVAL_ENABLED: 'true',
  FEATURE_AUDIT_LOG_ENABLED: 'false',
  FEATURE_SSO_ENABLED: 'false',

  // --- Execution defaults ---
  DEFAULT_EXECUTION_TIMEOUT_SEC: '300',
  DEFAULT_CONCURRENCY_LIMIT: '10',
  EXECUTION_RETENTION_DAYS: '90',
  WEBHOOK_RESPONSE_TIMEOUT_MS: '10000',

  // --- Business / billing ---
  DEFAULT_PLAN: 'free',
  TRIAL_LENGTH_DAYS: '14',
  BILLING_SUPPORT_URL: 'https://flowforge.dev/billing/help',

  // --- Misc formatting/limits ---
  MAX_WORKFLOW_NODES: '500',
  MAX_VARIABLES_PER_WORKSPACE: '200',
  LOG_LEVEL: 'info',
};

async function seedVariables() {
  let created = 0;
  let skipped = 0;
  for (const [key, value] of Object.entries(DEFAULT_VARIABLES)) {
    const result = await pool.query(
      `INSERT INTO "Variable" (id, "workspaceId", key, value, "createdBy", "updatedAt")
       VALUES ($1, NULL, $2, $3, $4, now())
       ON CONFLICT ("key") WHERE "workspaceId" IS NULL DO NOTHING
       RETURNING id`,
      [randomUUID(), key, value, 'seed-script']
    );
    if (result.rowCount) created++;
    else skipped++;
  }
  console.log(`Variables: ${created} created, ${skipped} already existed (${Object.keys(DEFAULT_VARIABLES).length} total defaults).`);
}

async function seedDataTypeShowcase() {
  const workspaces = await pool.query<{ id: string; ownerId: string }>(`SELECT id, "ownerId" FROM "Workspace"`);
  if (workspaces.rowCount === 0) {
    console.log('Data Type Showcase: no workspaces exist yet — skipping (run again after creating one).');
    return;
  }

  const columns = COLUMN_TYPES.map((t) => ({ name: t.id, type: t.id }));
  const showcaseRow: Record<string, unknown> = {};
  const blankRow: Record<string, unknown> = {};
  for (const t of COLUMN_TYPES) {
    showcaseRow[t.id] = typeof t.example === 'object' ? JSON.stringify(t.example) : t.example;
    blankRow[t.id] = '';
  }

  for (const ws of workspaces.rows) {
    const existing = await pool.query(`SELECT id FROM "DataTable" WHERE "workspaceId" = $1 AND name = $2`, [
      ws.id,
      'Data Type Showcase',
    ]);
    if (existing.rowCount) {
      console.log(`Data Type Showcase: already present in workspace ${ws.id} — skipping.`);
      continue;
    }
    const tableId = randomUUID();
    await pool.query(
      `INSERT INTO "DataTable" (id, "workspaceId", name, columns, "createdBy", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, now())`,
      [tableId, ws.id, 'Data Type Showcase', JSON.stringify(columns), ws.ownerId]
    );
    await pool.query(
      `INSERT INTO "DataTableRow" (id, "dataTableId", data, "updatedAt") VALUES ($1, $2, $3, now())`,
      [randomUUID(), tableId, JSON.stringify(showcaseRow)]
    );
    await pool.query(
      `INSERT INTO "DataTableRow" (id, "dataTableId", data, "updatedAt") VALUES ($1, $2, $3, now())`,
      [randomUUID(), tableId, JSON.stringify(blankRow)]
    );
    console.log(`Data Type Showcase: created in workspace ${ws.id} with ${COLUMN_TYPES.length} columns.`);
  }
}

async function main() {
  console.log(`Seeding ${Object.keys(DEFAULT_VARIABLES).length} default variables and a ${COLUMN_TYPES.length}-column Data Type Showcase table...`);
  await seedVariables();
  await seedDataTypeShowcase();
  await pool.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
