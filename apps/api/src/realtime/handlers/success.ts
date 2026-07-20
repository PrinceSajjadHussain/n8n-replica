import type { RealtimeStatusHandler } from './types';
import { broadcastRooms } from './types';

const handleSuccess: RealtimeStatusHandler = (io, ownerId, event) => {
  io.to(broadcastRooms(ownerId, event.workflowId)).emit('node:completed', event);
};

export default handleSuccess;
