/**
 * Email trigger poller — connects to an IMAP mailbox with imapflow, watches
 * for new messages (IDLE where supported, falling back to polling), parses
 * them with mailparser, and enqueues a run for every message matching the
 * configured filter. Pairs with the no-op `emailTrigger` node in
 * apps/worker/src/nodes/triggerNodes.ts, which just receives the parsed
 * message as its `input`.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { randomUUID } from 'crypto';
import { createExecutionQueue, createRedisConnection } from '../queue/queue';
import type { ExecutionJobData } from '@flowforge/shared-types';

const connection = createRedisConnection();
const queue = createExecutionQueue(connection);

export interface EmailTriggerConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
  mailbox?: string; // default 'INBOX'
  fromFilter?: string; // only fire for messages where From contains this substring
  subjectFilter?: string; // only fire for messages where Subject contains this substring
  markSeen?: boolean; // default true
}

async function enqueueEmailTrigger(workflowId: string, userId: string, message: Record<string, unknown>) {
  const jobData: ExecutionJobData = {
    executionId: randomUUID(),
    workflowId,
    userId,
    triggerType: 'emailTrigger',
    triggerPayload: message,
  };
  await queue.add(`execute:emailTrigger:${workflowId}`, jobData);
}

function matchesFilters(config: EmailTriggerConfig, from: string, subject: string): boolean {
  if (config.fromFilter && !from.toLowerCase().includes(config.fromFilter.toLowerCase())) return false;
  if (config.subjectFilter && !subject.toLowerCase().includes(config.subjectFilter.toLowerCase())) return false;
  return true;
}

/**
 * Opens a persistent IMAP connection for one workflow's email trigger.
 * Uses IDLE (push notifications) when the server supports it, otherwise
 * falls back to a 30s poll loop — both paths converge on the same
 * `handleNewMessages` fetch-and-enqueue logic.
 *
 * Returns a teardown function to close the connection (call on workflow
 * deactivation / API shutdown).
 */
export async function registerEmailTrigger(
  workflowId: string,
  userId: string,
  config: EmailTriggerConfig
): Promise<() => Promise<void>> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    logger: false,
  });

  await client.connect();
  const mailbox = config.mailbox ?? 'INBOX';
  let stopped = false;

  async function handleNewMessages() {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const searchCriteria = { seen: false } as const;
      for await (const message of client.fetch(searchCriteria, { source: true, envelope: true })) {
        const parsed = await simpleParser(message.source as Buffer);
        const from = parsed.from?.text ?? '';
        const subject = parsed.subject ?? '';
        if (!matchesFilters(config, from, subject)) continue;

        await enqueueEmailTrigger(workflowId, userId, {
          from,
          to: parsed.to && 'text' in parsed.to ? parsed.to.text : undefined,
          subject,
          text: parsed.text ?? '',
          html: parsed.html || undefined,
          attachments: (parsed.attachments ?? []).map((a: { filename?: string; contentType: string; size: number }) => ({
            filename: a.filename,
            contentType: a.contentType,
            size: a.size,
          })),
          receivedAt: parsed.date?.toISOString() ?? new Date().toISOString(),
        });

        if (config.markSeen ?? true) {
          await client.messageFlagsAdd(message.uid, ['\\Seen'], { uid: true });
        }
      }
    } finally {
      lock.release();
    }
  }

  // Initial sweep for any unseen messages already sitting in the mailbox.
  await handleNewMessages().catch(() => {});

  if (client.capabilities?.has?.('IDLE')) {
    (async () => {
      while (!stopped) {
        try {
          await client.mailboxOpen(mailbox);
          await client.idle(); // resolves when the server pushes a change notification
          if (!stopped) await handleNewMessages();
        } catch {
          if (!stopped) await new Promise((r) => setTimeout(r, 5000));
        }
      }
    })();
  } else {
    const interval = setInterval(() => {
      if (!stopped) void handleNewMessages().catch(() => {});
    }, 30000);
    (client as unknown as { __pollInterval?: NodeJS.Timeout }).__pollInterval = interval;
  }

  return async () => {
    stopped = true;
    const interval = (client as unknown as { __pollInterval?: NodeJS.Timeout }).__pollInterval;
    if (interval) clearInterval(interval);
    await client.logout().catch(() => {});
  };
}
