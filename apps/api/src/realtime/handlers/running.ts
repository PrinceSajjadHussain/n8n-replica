import type { RealtimeStatusHandler } from './types';
import { broadcastRooms } from './types';

const handleRunning: RealtimeStatusHandler = (io, ownerId, event) => {
  io.to(broadcastRooms(ownerId, event.workflowId)).emit('node:started', event);
};

export default handleRunning;
