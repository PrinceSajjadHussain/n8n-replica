/**
 * Trigger pollers for the "additional triggers" node types (databaseChange,
 * streamTrigger, fileWatcher). Each poller enqueues an ExecutionJobData onto
 * the same BullMQ queue the scheduler uses, seeding triggerPayload with the
 * event that fired — the worker's engine hands that straight to the
 * corresponding trigger node's `input` (see nodes/triggerNodes.ts).
 *
 * Redis Streams, Kafka, and RabbitMQ each get a native, dependency-real
 * consumer below (kafkajs / amqplib / ioredis are already dependencies).
 * Email (IMAP) polling lives in emailPoller.ts, since it needs its own
 * connection lifecycle (IDLE) rather than a simple read loop.
 */
import { Client as PgClient } from 'pg';
import IORedis from 'ioredis';
import fs from 'fs';
import { Kafka, logLevel } from 'kafkajs';
import type { SASLOptions } from 'kafkajs';
import amqp from 'amqplib';
import { randomUUID } from 'crypto';
import { createExecutionQueue, createRedisConnection } from '../queue/queue';
import type { ExecutionJobData } from '@flowforge/shared-types';

const connection = createRedisConnection();
const queue = createExecutionQueue(connection);

async function enqueueTrigger(workflowId: string, userId: string, triggerType: string, payload: unknown) {
  const jobData: ExecutionJobData = {
    executionId: randomUUID(),
    workflowId,
    userId,
    triggerType: triggerType as ExecutionJobData['triggerType'],
    triggerPayload: payload as Record<string, unknown>,
  };
  await queue.add(`execute:${triggerType}:${workflowId}`, jobData);
}

/**
 * Kafka trigger — consumes a topic directly via kafkajs (no bridge needed).
 * Each consumer uses its own consumer group per workflow so multiple
 * workflows (or multiple worker instances for HA) can independently
 * subscribe to the same topic without stealing each other's messages.
 */
export async function registerKafkaTrigger(
  workflowId: string,
  userId: string,
  config: { brokers: string[]; topic: string; groupId?: string; ssl?: boolean; sasl?: { mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512'; username: string; password: string } }
): Promise<() => Promise<void>> {
  const kafka = new Kafka({
    clientId: `flowforge-${workflowId}`,
    brokers: config.brokers,
    ssl: config.ssl,
    sasl: config.sasl as SASLOptions | undefined,
    logLevel: logLevel.NOTHING,
  });
  const consumer = kafka.consumer({ groupId: config.groupId ?? `flowforge-${workflowId}` });
  await consumer.connect();
  await consumer.subscribe({ topic: config.topic, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      let value: unknown = message.value?.toString('utf-8') ?? null;
      try {
        value = value ? JSON.parse(value as string) : null;
      } catch {
        /* keep raw string if not JSON */
      }
      await enqueueTrigger(workflowId, userId, 'streamTrigger', {
        source: 'kafka',
        topic,
        partition,
        offset: message.offset,
        key: message.key?.toString('utf-8') ?? null,
        value,
      });
    },
  });

  return async () => {
    await consumer.disconnect();
  };
}

/**
 * RabbitMQ trigger — consumes a queue directly via amqplib (no bridge
 * needed). Uses manual ack so a crashed worker leaves the message for
 * redelivery instead of silently dropping it.
 */
export async function registerRabbitMQTrigger(
  workflowId: string,
  userId: string,
  config: { url: string; queue: string; prefetch?: number }
): Promise<() => Promise<void>> {
  const connection = await amqp.connect(config.url);
  const channel = await connection.createChannel();
  await channel.assertQueue(config.queue, { durable: true });
  await channel.prefetch(config.prefetch ?? 10);

  await channel.consume(config.queue, async (msg) => {
    if (!msg) return;
    let value: unknown = msg.content.toString('utf-8');
    try {
      value = JSON.parse(value as string);
    } catch {
      /* keep raw string if not JSON */
    }
    try {
      await enqueueTrigger(workflowId, userId, 'streamTrigger', {
        source: 'rabbitmq',
        queue: config.queue,
        value,
        routingKey: msg.fields.routingKey,
      });
      channel.ack(msg);
    } catch {
      channel.nack(msg, false, true); // requeue on enqueue failure
    }
  });

  return async () => {
    await channel.close();
    await connection.close();
  };
}

/**
 * Database-change trigger: opens a dedicated connection and LISTENs on a
 * Postgres NOTIFY channel. Pair this with a trigger on the source table:
 *
 *   CREATE OR REPLACE FUNCTION flowforge_notify() RETURNS trigger AS $$
 *   BEGIN
 *     PERFORM pg_notify('flowforge_changes', row_to_json(NEW)::text);
 *     RETURN NEW;
 *   END; $$ LANGUAGE plpgsql;
 *   CREATE TRIGGER my_table_changes AFTER INSERT OR UPDATE ON my_table
 *   FOR EACH ROW EXECUTE FUNCTION flowforge_notify();
 *
 * channel defaults to 'flowforge_changes'; multiple workflows can share a
 * channel and filter in-workflow, or use per-table channel names.
 */
export async function registerDatabaseChangeTrigger(
  workflowId: string,
  userId: string,
  connectionString: string,
  channel = 'flowforge_changes'
): Promise<() => Promise<void>> {
  const client = new PgClient({ connectionString });
  await client.connect();
  await client.query(`LISTEN ${channel}`);
  client.on('notification', (msg) => {
    let payload: unknown = msg.payload;
    try {
      payload = JSON.parse(msg.payload ?? '{}');
    } catch {
      /* keep raw string if not JSON */
    }
    void enqueueTrigger(workflowId, userId, 'databaseChange', { channel: msg.channel, payload });
  });
  return async () => {
    await client.query(`UNLISTEN ${channel}`);
    await client.end();
  };
}

/**
 * Stream trigger (Redis Streams). Uses a consumer group so multiple worker
 * instances can share the read load without double-firing. For Kafka or
 * RabbitMQ, prefer registerKafkaTrigger / registerRabbitMQTrigger below —
 * this one is for teams standardizing on Redis as their one message bus.
 */
export async function registerStreamTrigger(
  workflowId: string,
  userId: string,
  streamKey: string,
  groupName = 'flowforge'
): Promise<() => Promise<void>> {
  const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
  try {
    await redis.xgroup('CREATE', streamKey, groupName, '$', 'MKSTREAM');
  } catch (err) {
    // BUSYGROUP means the group already exists — fine, keep going.
    if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
  }

  let stopped = false;
  const consumerName = `worker-${randomUUID().slice(0, 8)}`;

  (async () => {
    while (!stopped) {
      const results = await redis.xreadgroup(
        'GROUP', groupName, consumerName,
        'COUNT', 10, 'BLOCK', 5000,
        'STREAMS', streamKey, '>'
      ).catch(() => null);
      if (!results) continue;
      for (const [, entries] of results as unknown as [string, [string, string[]][]][]) {
        for (const [id, fields] of entries) {
          const payload: Record<string, string> = {};
          for (let i = 0; i < fields.length; i += 2) payload[fields[i]] = fields[i + 1];
          await enqueueTrigger(workflowId, userId, 'streamTrigger', { id, streamKey, payload });
          await redis.xack(streamKey, groupName, id);
        }
      }
    }
  })();

  return async () => {
    stopped = true;
    await redis.quit();
  };
}

/**
 * File-watcher trigger — uses Node's built-in fs.watch (no chokidar
 * dependency). Good for single-directory, non-recursive-glob cases; swap in
 * chokidar if you need debounced recursive globs across many files.
 */
export function registerFileWatcherTrigger(
  workflowId: string,
  userId: string,
  watchPath: string
): () => void {
  const watcher = fs.watch(watchPath, { persistent: true }, (eventType, filename) => {
    void enqueueTrigger(workflowId, userId, 'fileWatcher', {
      event: eventType,
      path: filename ? `${watchPath}/${filename}` : watchPath,
    });
  });
  return () => watcher.close();
}
