import { Server as SocketIOServer } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import IORedis from 'ioredis';
import { verifyAccessToken } from '../utils/jwt';
import { pool } from '../db/pool';
import { findUserById } from '../db/users';

const STATUS_CHANNEL = 'flowforge:execution-status';

interface PresenceViewer {
  userId: string;
  email: string;
  color: string;
}

// In-memory per-workflow viewer map. Fine for a single API process; if the
// API ever scales horizontally this would need to move to Redis (same
// pattern as the execution status pub/sub below) — flagged as a known
// follow-up rather than solved here, given presence is ephemeral/low-value
// to persist across a restart anyway.
const PRESENCE_COLORS = ['#f97316', '#22d3ee', '#a3e635', '#f472b6', '#818cf8', '#facc15'];
const workflowViewers = new Map<string, Map<string, PresenceViewer>>();

function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length];
}

function viewerList(workflowId: string): PresenceViewer[] {
  return Array.from(workflowViewers.get(workflowId)?.values() ?? []);
}

export function initRealtime(httpServer: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    path: '/ws/executions',
    cors: { origin: process.env.WEB_ORIGIN ?? '*' },
  });

  // Auth handshake: client must send a valid access token.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('Missing auth token'));
    try {
      const payload = verifyAccessToken(token);
      (socket.data as { userId: string }).userId = payload.sub;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = (socket.data as { userId: string }).userId;
    // Scope execution-status events to a per-user room.
    socket.join(`user:${userId}`);

    // Presence: a separate, workflow-scoped room that ANY collaborator with
    // access to the canvas can join (unlike the owner-only room above), so
    // co-editors see each other's viewer avatars and cursor positions.
    let presenceWorkflowId: string | null = null;

    socket.on('presence:join', async (payload: { workflowId: string }) => {
      const workflowId = payload?.workflowId;
      if (!workflowId) return;
      presenceWorkflowId = workflowId;
      socket.join(`workflow:${workflowId}`);

      const user = await findUserById(userId).catch(() => null);
      if (!workflowViewers.has(workflowId)) workflowViewers.set(workflowId, new Map());
      workflowViewers.get(workflowId)!.set(userId, {
        userId,
        email: user?.email ?? 'unknown',
        color: colorForUser(userId),
      });

      io.to(`workflow:${workflowId}`).emit('presence:viewers', { workflowId, viewers: viewerList(workflowId) });
    });

    socket.on('presence:leave', (payload: { workflowId: string }) => {
      const workflowId = payload?.workflowId ?? presenceWorkflowId;
      if (!workflowId) return;
      socket.leave(`workflow:${workflowId}`);
      workflowViewers.get(workflowId)?.delete(userId);
      io.to(`workflow:${workflowId}`).emit('presence:viewers', { workflowId, viewers: viewerList(workflowId) });
      if (workflowId === presenceWorkflowId) presenceWorkflowId = null;
    });

    // Cursor position, given as a fraction (0-1) of the canvas pane's
    // width/height so it stays comparable across different window sizes
    // and zoom levels without needing the full ReactFlow coordinate
    // transform on the server.
    socket.on('presence:cursor', (payload: { workflowId: string; x: number; y: number }) => {
      const workflowId = payload?.workflowId ?? presenceWorkflowId;
      if (!workflowId) return;
      socket.to(`workflow:${workflowId}`).emit('presence:cursor', {
        workflowId,
        userId,
        x: payload.x,
        y: payload.y,
      });
    });

    socket.on('disconnect', () => {
      if (!presenceWorkflowId) return;
      workflowViewers.get(presenceWorkflowId)?.delete(userId);
      io.to(`workflow:${presenceWorkflowId}`).emit('presence:viewers', {
        workflowId: presenceWorkflowId,
        viewers: viewerList(presenceWorkflowId),
      });
    });
  });

  // Subscribe to Redis pub/sub messages published by the worker and relay
  // them to the correct user's Socket.IO room, translated into the named
  // events the frontend expects.
  const subscriber = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  subscriber.subscribe(STATUS_CHANNEL);
  subscriber.on('message', async (_channel, message) => {
    try {
      const event = JSON.parse(message) as {
        workflowId: string;
        executionId: string;
        nodeId?: string;
        status: string;
        output?: unknown;
        input?: unknown;
        error?: string;
        durationMs?: number;
        itemCount?: number;
      };

      // Resolve which user owns this workflow so we scope the broadcast.
      const result = await pool.query(`SELECT "userId" FROM "Workflow" WHERE id = $1`, [
        event.workflowId,
      ]);
      const userId = result.rows[0]?.userId;
      if (!userId) return;

      const room = `user:${userId}`;
      switch (event.status) {
        case 'started':
          io.to(room).emit('execution:started', event);
          break;
        case 'running':
          io.to(room).emit('node:started', event);
          break;
        case 'success':
          io.to(room).emit('node:completed', event);
          break;
        case 'failed':
          io.to(room).emit('node:failed', event);
          break;
        case 'skipped':
          io.to(room).emit('node:skipped', event);
          break;
        case 'completed':
          io.to(room).emit('execution:completed', event);
          break;
      }
    } catch (err) {
      console.error('Failed to relay realtime event', err);
    }
  });

  return io;
}
