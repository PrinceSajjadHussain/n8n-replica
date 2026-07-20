import type { RealtimeStatusHandler } from './types';
import { broadcastRooms } from './types';

/**
 * Previously fell through the old switch with no case and was silently
 * dropped, even though `executor.ts` correctly emits it (pause/resume
 * with persisted checkpoints, n8n's `waitTill` equivalent) and
 * `publisher.ts` correctly publishes it. Without this, the canvas looked
 * frozen on any workflow that paused (e.g. a `waitForWebhook` node).
 */
const handlePaused: RealtimeStatusHandler = (io, ownerId, event) => {
  io.to(broadcastRooms(ownerId, event.workflowId)).emit('execution:paused', event);
};

export default handlePaused;
