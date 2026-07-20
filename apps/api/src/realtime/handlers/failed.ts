import type { RealtimeStatusHandler } from './types';
import { broadcastRooms } from './types';

const handleFailed: RealtimeStatusHandler = (io, ownerId, event) => {
  io.to(broadcastRooms(ownerId, event.workflowId)).emit('node:failed', event);
};

export default handleFailed;
