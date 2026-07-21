import IORedis from 'ioredis';
import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * REDIS CHAT MEMORY
 * =================
 * Simple, shared, multi-instance-safe conversation history for a
 * `chatTrigger` -> `gemini`/`openai`/`anthropic` chat flow, keyed by
 * `sessionId`. Unlike `agentMemory` (which persists to a local JSON file on
 * disk — fine for a single worker, not shared across replicas), this node
 * stores turns in Redis, so any worker instance handling a request for the
 * same session sees the same history. Uses the same REDIS_URL already
 * configured for the execution queue.
 *
 * Typical wiring for a chat + Gemini bot with memory:
 *
 *   chatTrigger -> redisMemory (action: "read")  -> gemini -> redisMemory (action: "write")
 *
 * "read" returns both the raw `turns` array and a ready-to-splice
 * `historyText` string, so the Gemini node's `prompt` param can just do:
 *
 *   Conversation so far:
 *   {{$node["Read Memory"].json.historyText}}
 *
 *   User: {{$node["When chat message received"].json.message}}
 *
 * "write" appends one turn ({ role, content }) or several at once
 * (`turns: [{ role, content }, ...]`) — e.g. after the model replies, write
 * both the user's message and the assistant's answer in one call.
 *
 * params:
 *   action: 'read' | 'write' | 'clear'        default 'read'
 *   sessionId: string                         required (usually {{$json.sessionId}})
 *   maxTurns?: number                         'read': how many recent turns to return (default 20)
 *   maxHistory?: number                       'write': how many turns to retain total, oldest trimmed first (default 100)
 *   ttlSeconds?: number                       'write': optional expiry on the session key (e.g. 86400 for 24h)
 *   role?: 'user' | 'assistant' | 'system'    'write': single-turn shorthand
 *   content?: string                          'write': single-turn shorthand
 *   turns?: Array<{ role, content }>          'write': multi-turn form (takes precedence over role/content)
 */

export interface ChatTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
  at: string;
}

const REDIS_KEY_PREFIX = 'flowforge:chatmem:';

let sharedConnection: IORedis | null = null;

function getRedis(): IORedis {
  if (!sharedConnection) {
    sharedConnection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
  }
  return sharedConnection;
}

function keyFor(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_.:-]/g, '_');
  return `${REDIS_KEY_PREFIX}${safe}`;
}

function toHistoryText(turns: ChatTurn[]): string {
  return turns.map((t) => `${t.role}: ${t.content}`).join('\n');
}

/** Shared by agentNode.ts: when an Agent's "Memory" sub-input is wired to a
 *  Redis Chat Memory node, the agent uses these instead of its own local
 *  file-based memory, so the connection on the canvas actually does
 *  something instead of being purely decorative. */
export async function readRedisTurns(sessionId: string, maxTurns = 20): Promise<ChatTurn[]> {
  const redis = getRedis();
  const raw = await redis.lrange(keyFor(sessionId), -maxTurns, -1);
  return raw.map((r) => {
    try {
      return JSON.parse(r) as ChatTurn;
    } catch {
      return { role: 'user', content: r, at: new Date().toISOString() };
    }
  });
}

export async function appendRedisTurns(
  sessionId: string,
  turns: Array<{ role: ChatTurn['role']; content: string }>,
  opts: { maxHistory?: number; ttlSeconds?: number } = {}
): Promise<void> {
  if (turns.length === 0) return;
  const redis = getRedis();
  const key = keyFor(sessionId);
  const pipeline = redis.pipeline();
  for (const turn of turns) pipeline.rpush(key, JSON.stringify({ ...turn, at: new Date().toISOString() }));
  pipeline.ltrim(key, -(opts.maxHistory ?? 100), -1);
  if (opts.ttlSeconds && opts.ttlSeconds > 0) pipeline.expire(key, opts.ttlSeconds);
  await pipeline.exec();
}

export async function clearRedisTurns(sessionId: string): Promise<void> {
  await getRedis().del(keyFor(sessionId));
}

export const redisMemoryNode: NodePlugin = {
  type: 'redisMemory',
  async execute({ params }) {
    const sessionId = String(params.sessionId ?? '').trim();
    if (!sessionId) {
      throw new Error('redisMemory node: params.sessionId is required (e.g. {{$json.sessionId}} from chatTrigger).');
    }
    const action = String(params.action ?? 'read');
    const redis = getRedis();
    const key = keyFor(sessionId);

    if (action === 'clear') {
      await redis.del(key);
      return { output: { cleared: true, sessionId } };
    }

    if (action === 'write') {
      const explicitTurns = params.turns as Array<{ role?: string; content?: string }> | undefined;
      const singleTurn =
        params.content !== undefined ? [{ role: (params.role as string) ?? 'user', content: String(params.content) }] : [];
      const incoming: ChatTurn[] = (explicitTurns && explicitTurns.length > 0 ? explicitTurns : singleTurn).map((t) => ({
        role: (t.role as ChatTurn['role']) ?? 'user',
        content: String(t.content ?? ''),
        at: new Date().toISOString(),
      }));
      if (incoming.length === 0) {
        throw new Error('redisMemory node: action "write" requires params.content (+ optional role) or params.turns[].');
      }

      const maxHistory = Number(params.maxHistory ?? 100);
      const pipeline = redis.pipeline();
      for (const turn of incoming) pipeline.rpush(key, JSON.stringify(turn));
      pipeline.ltrim(key, -maxHistory, -1);
      const ttlSeconds = Number(params.ttlSeconds ?? 0);
      if (ttlSeconds > 0) pipeline.expire(key, ttlSeconds);
      await pipeline.exec();

      // Convenience for chat workflows that end on this node (e.g.
      // chatTrigger's "reply with final node output" mode): surface the
      // assistant turn just written as `reply`, so the HTTP response body
      // is the actual answer text, not just a write confirmation.
      const assistantTurn = [...incoming].reverse().find((t) => t.role === 'assistant');
      return {
        output: {
          written: incoming.length,
          sessionId,
          reply: assistantTurn?.content ?? incoming[incoming.length - 1]?.content ?? null,
        },
      };
    }

    // action === 'read' (default)
    const maxTurns = Number(params.maxTurns ?? 20);
    const raw = await redis.lrange(key, -maxTurns, -1);
    const turns: ChatTurn[] = raw.map((r) => {
      try {
        return JSON.parse(r) as ChatTurn;
      } catch {
        return { role: 'user', content: r, at: new Date().toISOString() };
      }
    });

    return {
      output: {
        turns,
        historyText: toHistoryText(turns),
        count: turns.length,
        sessionId,
      },
    };
  },
};

registerNode(redisMemoryNode);