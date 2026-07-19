import { Router } from 'express';
import { randomUUID } from 'crypto';
import { pool } from '../db/pool';
import { executionQueue, waitForWebhookResponse, DEFAULT_WEBHOOK_TIMEOUT_MS } from './webhook';
import type { ExecutionJobData } from '@flowforge/shared-types';
import { incrementUsage } from '../db/billing';

/**
 * Public form trigger — n8n's "Form" node: a hosted, shareable URL that
 * shows a plain HTML form and starts a run on submit. No separate frontend
 * build needed; the form itself is server-rendered from the `formTrigger`
 * node's `fields` param.
 *
 * Scope of this round: the trigger form only. n8n's Form node can also
 * pause a workflow mid-run for a second form page (e.g. multi-step
 * intake); that would need a dedicated "Form" pause node reusing the same
 * token/resume mechanism `waitForWebhook`/`humanApproval` already have —
 * not built here, see README "Public form trigger (this round)".
 */

export interface FormField {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'email' | 'number' | 'date' | 'checkbox';
  required?: boolean;
}

export const formRouter = Router();

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function renderForm(title: string, fields: FormField[], submitLabel: string, errorMessage?: string): string {
  const inputs = fields
    .map((f) => {
      const req = f.required ? 'required' : '';
      const label = `<label for="${escapeHtml(f.name)}">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>`;
      if (f.type === 'textarea') {
        return `${label}<textarea id="${escapeHtml(f.name)}" name="${escapeHtml(f.name)}" ${req}></textarea>`;
      }
      if (f.type === 'checkbox') {
        return `<label class="checkbox"><input type="checkbox" id="${escapeHtml(f.name)}" name="${escapeHtml(f.name)}" /> ${escapeHtml(f.label)}</label>`;
      }
      return `${label}<input type="${f.type ?? 'text'}" id="${escapeHtml(f.name)}" name="${escapeHtml(f.name)}" ${req} />`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #0B0D12; color: #E7E9EE; max-width: 520px; margin: 48px auto; padding: 0 20px; }
  h1 { font-size: 1.25rem; margin-bottom: 1.5rem; }
  label { display: block; font-size: 0.85rem; margin: 1rem 0 0.35rem; color: #B4B8C2; }
  label.checkbox { display: flex; align-items: center; gap: 0.5rem; color: #E7E9EE; }
  input, textarea { width: 100%; box-sizing: border-box; padding: 0.6rem 0.75rem; border-radius: 8px; border: 1px solid #2A2E3A; background: #14171F; color: #E7E9EE; font: inherit; }
  textarea { min-height: 100px; }
  button { margin-top: 1.5rem; padding: 0.65rem 1.4rem; border-radius: 8px; border: none; background: #6D5DFB; color: white; font-weight: 600; cursor: pointer; }
  .error { color: #F87171; margin-bottom: 1rem; font-size: 0.9rem; }
</style></head>
<body>
<h1>${escapeHtml(title)}</h1>
${errorMessage ? `<p class="error">${escapeHtml(errorMessage)}</p>` : ''}
<form method="POST">
${inputs}
<button type="submit">${escapeHtml(submitLabel)}</button>
</form>
</body></html>`;
}

async function findFormTrigger(workflowId: string) {
  const wfResult = await pool.query(
    `SELECT id, "userId", "workspaceId", "isActive", "nodesJson" FROM "Workflow" WHERE id = $1`,
    [workflowId]
  );
  return wfResult.rows[0] ?? null;
}

/** GET /form/:workflowId/:path — renders the hosted form page. */
formRouter.get('/:workflowId/:path', async (req, res) => {
  const { workflowId, path } = req.params;
  const workflow = await findFormTrigger(workflowId);
  if (!workflow || !workflow.isActive) {
    return res.status(404).send('Form not found.');
  }
  const nodes = workflow.nodesJson as Array<{ type: string; params?: Record<string, unknown> }>;
  const formNode = nodes.find((n) => n.type === 'formTrigger' && (n.params?.path ?? 'default') === path);
  if (!formNode) {
    return res.status(404).send('Form not found.');
  }
  const title = String(formNode.params?.title ?? 'Form');
  const fields = (formNode.params?.fields as FormField[] | undefined) ?? [];
  const submitLabel = String(formNode.params?.submitLabel ?? 'Submit');
  res.type('html').send(renderForm(title, fields, submitLabel));
});

/** POST /form/:workflowId/:path — handles submission, starts a run, and shows a thank-you page. */
formRouter.post('/:workflowId/:path', async (req, res) => {
  const { workflowId, path } = req.params;
  const workflow = await findFormTrigger(workflowId);
  if (!workflow || !workflow.isActive) {
    return res.status(404).send('Form not found.');
  }
  const nodes = workflow.nodesJson as Array<{ type: string; params?: Record<string, unknown> }>;
  const formNode = nodes.find((n) => n.type === 'formTrigger' && (n.params?.path ?? 'default') === path);
  if (!formNode) {
    return res.status(404).send('Form not found.');
  }

  const fields = (formNode.params?.fields as FormField[] | undefined) ?? [];
  const missing = fields.filter((f) => f.required && !req.body?.[f.name]);
  if (missing.length > 0) {
    const title = String(formNode.params?.title ?? 'Form');
    const submitLabel = String(formNode.params?.submitLabel ?? 'Submit');
    return res
      .status(400)
      .type('html')
      .send(renderForm(title, fields, submitLabel, `Missing required field${missing.length > 1 ? 's' : ''}: ${missing.map((f) => f.label).join(', ')}`));
  }

  const executionId = randomUUID();
  const jobData: ExecutionJobData = {
    executionId,
    workflowId: workflow.id,
    userId: workflow.userId,
    triggerType: 'formTrigger' as ExecutionJobData['triggerType'],
    triggerPayload: req.body ?? {},
  };

  const responseMode = (formNode.params?.responseMode as string | undefined) ?? 'immediately';
  if (responseMode === 'lastNode') {
    const waiter = waitForWebhookResponse(executionId, 'lastNode', DEFAULT_WEBHOOK_TIMEOUT_MS);
    await executionQueue.add('execute', jobData);
    if (workflow.workspaceId) incrementUsage(workflow.workspaceId).catch(() => {});
    await waiter;
  } else {
    await executionQueue.add('execute', jobData);
    if (workflow.workspaceId) incrementUsage(workflow.workspaceId).catch(() => {});
  }

  const thankYouMessage = String(formNode.params?.thankYouMessage ?? 'Thanks — your submission was received.');
  res.type('html').send(`<!DOCTYPE html><html><body style="font-family:-apple-system,system-ui,sans-serif;background:#0B0D12;color:#E7E9EE;max-width:520px;margin:96px auto;text-align:center;padding:0 20px;">
    <p style="font-size:1.1rem;">${escapeHtml(thankYouMessage)}</p>
  </body></html>`);
});
