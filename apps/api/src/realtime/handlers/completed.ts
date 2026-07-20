import type { RealtimeStatusHandler } from './types';
import { broadcastRooms } from './types';

const handleCompleted: RealtimeStatusHandler = (io, ownerId, event) => {
  io.to(broadcastRooms(ownerId, event.workflowId)).emit('execution:completed', event);
};

export default handleCompleted;
