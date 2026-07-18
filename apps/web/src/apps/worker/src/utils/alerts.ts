import axios from 'axios';
import { pool } from '../db/pool';
import { randomUUID } from 'crypto';

interface AlertConfigRow {
  id: string;
  channel: 'email' | 'webhook';
  target: string;
  onFailure: boolean;
  onSuccess: boolean;
}

/**
 * Fires any configured alerts for a workflow when an execution finishes.
 * Always records an ActivityLog row (so failures show up in the in-app
 * activity feed even if no external channel is configured or delivery
 * fails), then best-effort delivers to email/webhook targets.
 *
 * Never throws — a notification failure must never fail the execution
 * that triggered it.
 */
export async function dispatchExecutionAlerts(
  workflowId: string,
  executionId: string,
  status: 'success' | 'failed',
  errorMessage?: string
): Promise<void> {
  try {
    const wfResult = await pool.query(`SELECT "workspaceId", name, "userId" FROM "Workflow" WHERE id = $1`, [
      workflowId,
    ]);
    const workflow = wfResult.rows[0];

    await pool.query(
      `INSERT INTO "ActivityLog" (id, "workspaceId", "workflowId", "userId", action, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        randomUUID(),
        workflow?.workspaceId ?? null,
        workflowId,
        null,
        status === 'failed' ? 'execution.failed' : 'execution.succeeded',
        JSON.stringify({ executionId, error: errorMessage ?? null }),
      ]
    );

    const configResult = await pool.query(
      `SELECT id, channel, target, "onFailure", "onSuccess" FROM "AlertConfig"
       WHERE "workflowId" = $1 AND "isActive" = true`,
      [workflowId]
    );
    const configs: AlertConfigRow[] = configResult.rows;
    const toFire = configs.filter((c) => (status === 'failed' ? c.onFailure : c.onSuccess));
    if (toFire.length === 0) return;

    const workflowName = workflow?.name ?? workflowId;
    const subject = `[FlowForge] "${workflowName}" execution ${status}`;
    const summary =
      status === 'failed'
        ? `Execution ${executionId} of "${workflowName}" failed${errorMessage ? `: ${errorMessage}` : '.'}`
        : `Execution ${executionId} of "${workflowName}" completed successfully.`;

    await Promise.all(
      toFire.map((config) => deliverAlert(config, { workflowId, executionId, status, subject, summary, errorMessage }))
    );
  } catch (err) {
    console.error('[alerts] failed to dispatch execution alerts', err);
  }
}

async function deliverAlert(
  config: AlertConfigRow,
  payload: {
    workflowId: string;
    executionId: string;
    status: 'success' | 'failed';
    subject: string;
    summary: string;
    errorMessage?: string;
  }
): Promise<void> {
  try {
    if (config.channel === 'webhook') {
      await axios.post(
        config.target,
        {
          event: 'execution.finished',
          workflowId: payload.workflowId,
          executionId: payload.executionId,
          status: payload.status,
          error: payload.errorMessage ?? null,
          message: payload.summary,
        },
        { timeout: 10_000 }
      );
      return;
    }

    // Email channel: deliver via a configured HTTP email provider (Resend or
    // SendGrid) when credentials are available. If nothing is configured we
    // still recorded the ActivityLog row above, so the failure remains
    // visible in-app — we just skip the external send.
    if (process.env.RESEND_API_KEY) {
      await axios.post(
        'https://api.resend.com/emails',
        {
          from: process.env.ALERTS_FROM_EMAIL ?? 'alerts@flowforge.dev',
          to: config.target,
          subject: payload.subject,
          text: payload.summary,
        },
        { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, timeout: 10_000 }
      );
    } else if (process.env.SENDGRID_API_KEY) {
      await axios.post(
        'https://api.sendgrid.com/v3/mail/send',
        {
          personalizations: [{ to: [{ email: config.target }] }],
          from: { email: process.env.ALERTS_FROM_EMAIL ?? 'alerts@flowforge.dev' },
          subject: payload.subject,
          content: [{ type: 'text/plain', value: payload.summary }],
        },
        { headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}` }, timeout: 10_000 }
      );
    } else {
      console.warn(
        `[alerts] email alert to ${config.target} not sent: configure RESEND_API_KEY or SENDGRID_API_KEY`
      );
    }
  } catch (err) {
    console.error(`[alerts] failed to deliver ${config.channel} alert to ${config.target}`, err);
  }
}
