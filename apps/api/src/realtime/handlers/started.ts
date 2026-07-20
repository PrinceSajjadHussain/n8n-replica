import type { RealtimeStatusHandler } from './types';
import { broadcastRooms } from './types';

const handleStarted: RealtimeStatusHandler = (io, ownerId, event) => {
  io.to(broadcastRooms(ownerId, event.workflowId)).emit('execution:started', event);
};

export default handleStarted;
