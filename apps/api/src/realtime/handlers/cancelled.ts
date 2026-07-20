import type { RealtimeStatusHandler } from './types';
import { broadcastRooms } from './types';

const handleCancelled: RealtimeStatusHandler = (io, ownerId, event) => {
  io.to(broadcastRooms(ownerId, event.workflowId)).emit('execution:cancelled', event);
};

export default handleCancelled;
