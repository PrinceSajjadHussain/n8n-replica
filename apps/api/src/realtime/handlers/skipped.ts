import type { RealtimeStatusHandler } from './types';
import { broadcastRooms } from './types';

const handleSkipped: RealtimeStatusHandler = (io, ownerId, event) => {
  io.to(broadcastRooms(ownerId, event.workflowId)).emit('node:skipped', event);
};

export default handleSkipped;
