/**
 * Activation for the "long-lived in-process connection" trigger types —
 * RSS/Atom, MQTT, file watcher, database-change (Postgres LISTEN), and
 * stream triggers (Kafka/RabbitMQ/Redis Streams). These are distinct from
 * the Schedule trigger (apps/api/src/utils/scheduler.ts), which is a BullMQ
 * repeatable job and needs no in-process handle, and from webhook/chat
 * triggers, which are just Express routes with no activation step at all.
 *
 * Prior to this file existing, the register* functions in triggerPollers.ts
 * were fully implemented but never called from anywhere in the codebase —
 * a workflow with a `fileWatcher`/`databaseChange`/`streamTrigger` node and
 * `isActive: true` would sit there doing nothing. This wires them up the
 * same way `/:id/activate` already wires up Schedule
 * (registerScheduleForWorkflow/unregisterScheduleForWorkflow): on
 * activate/deactivate, on (re-)publish (params may have changed), and once
 * at API boot for every workflow that's already active when the process
 * starts (since these are in-process handles, they don't survive a
 * restart the way a BullMQ repeatable job does).
 *
 * One caveat that's out of scope to fully fix here: this registry is
 * per-process and in-memory, so running more than one API instance would
 * start duplicate pollers/subscribers per workflow (harmless for MQTT/Kafka
 * consumer-group topics, but would double-fire for the plain-Set RSS
 * dedupe and the fs.watch file watcher). See "Multi-region / horizontal
 * worker scaling" in the parity doc.
 */
import { pool } from '../db/pool';
import {
  registerRssTrigger,
  registerMqttTrigger,
  registerFileWatcherTrigger,
  registerDatabaseChangeTrigger,
  registerKafkaTrigger,
  registerRabbitMQTrigger,
  registerStreamTrigger,
} from './triggerPollers';

type StopFn = () => void | Promise<void>;

interface WorkflowNode {
  type: string;
  params?: Record<string, unknown>;
}

const activeStops = new Map<string, StopFn[]>();

async function stopAll(workflowId: string): Promise<void> {
  const stops = activeStops.get(workflowId);
  if (!stops) return;
  activeStops.delete(workflowId);
  for (const stop of stops) {
    try {
      await stop();
    } catch (err) {
      console.error(`Error stopping a trigger poller for workflow ${workflowId}:`, err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Starts every poller-based trigger node found in the workflow's published
 * (falling back to draft) graph. Always stops any pollers already running
 * for this workflow first, so this is safe to call repeatedly (activate,
 * re-publish, boot-time reconciliation) without leaking duplicate
 * subscriptions.
 */
export async function activateWorkflowPollers(workflowId: string, userId: string): Promise<void> {
  await stopAll(workflowId);

  const result = await pool.query(
    `SELECT "nodesJson", "publishedNodesJson" FROM "Workflow" WHERE id = $1`,
    [workflowId]
  );
  const row = result.rows[0];
  if (!row) return;
  const nodes = (row.publishedNodesJson ?? row.nodesJson ?? []) as WorkflowNode[];

  const stops: StopFn[] = [];

  for (const node of nodes) {
    try {
      switch (node.type) {
        case 'rssTrigger': {
          const feedUrl = String(node.params?.feedUrl ?? '');
          if (!feedUrl) break;
          const pollIntervalSec = Number(node.params?.pollIntervalSec ?? 300);
          stops.push(registerRssTrigger(workflowId, userId, feedUrl, pollIntervalSec));
          break;
        }
        case 'mqttTrigger': {
          const brokerUrl = String(node.params?.brokerUrl ?? '');
          const topic = String(node.params?.topic ?? '');
          if (!brokerUrl || !topic) break;
          const stop = await registerMqttTrigger(workflowId, userId, {
            brokerUrl,
            topic,
            username: node.params?.username ? String(node.params.username) : undefined,
            password: node.params?.password ? String(node.params.password) : undefined,
            qos: (Number(node.params?.qos ?? 0) as 0 | 1 | 2),
          });
          stops.push(stop);
          break;
        }
        case 'fileWatcher': {
          const watchPath = String(node.params?.path ?? '');
          if (!watchPath) break;
          stops.push(registerFileWatcherTrigger(workflowId, userId, watchPath));
          break;
        }
        case 'databaseChange': {
          const connectionString = String(node.params?.connectionString ?? '');
          if (!connectionString) break;
          const channel = node.params?.channel ? String(node.params.channel) : undefined;
          stops.push(await registerDatabaseChangeTrigger(workflowId, userId, connectionString, channel));
          break;
        }
        case 'streamTrigger': {
          const provider = String(node.params?.provider ?? 'kafka');
          if (provider === 'kafka' && node.params?.kafka) {
            stops.push(await registerKafkaTrigger(workflowId, userId, node.params.kafka as any));
          } else if (provider === 'rabbitmq' && node.params?.rabbitmq) {
            stops.push(await registerRabbitMQTrigger(workflowId, userId, node.params.rabbitmq as any));
          } else if (provider === 'redis' && node.params?.redis) {
            const redisConfig = node.params.redis as { streamKey: string; groupName?: string };
            stops.push(await registerStreamTrigger(workflowId, userId, redisConfig.streamKey, redisConfig.groupName));
          }
          break;
        }
        default:
          break;
      }
    } catch (err) {
      console.error(`Failed to start poller for ${node.type} on workflow ${workflowId}:`, err instanceof Error ? err.message : err);
    }
  }

  if (stops.length > 0) activeStops.set(workflowId, stops);
}

export async function deactivateWorkflowPollers(workflowId: string): Promise<void> {
  await stopAll(workflowId);
}

/**
 * Called once at API boot: starts pollers for every workflow that's
 * already `isActive` (since these in-process handles don't survive a
 * process restart the way a BullMQ repeatable job does). Failures for one
 * workflow are logged and don't block the rest from activating.
 */
export async function reconcileAllWorkflowPollersOnBoot(): Promise<void> {
  const result = await pool.query(`SELECT id, "userId" FROM "Workflow" WHERE "isActive" = true`);
  for (const row of result.rows) {
    await activateWorkflowPollers(row.id, row.userId).catch((err) =>
      console.error(`Boot-time poller activation failed for workflow ${row.id}:`, err instanceof Error ? err.message : err)
    );
  }
}
