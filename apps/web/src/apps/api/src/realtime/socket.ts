import { Server as SocketIOServer } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import IORedis from 'ioredis';
import { verifyAccessToken } from '../utils/jwt';
import { pool } from '../db/pool';

const STATUS_CHANNEL = 'flowforge:execution-status';

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
    // Scope events to a per-user room.
    socket.join(`user:${userId}`);
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
        error?: string;
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
