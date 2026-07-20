import type { RealtimeStatusHandler } from './types';
import { broadcastRooms } from './types';

/**
 * Previously fell through the old switch with no case and was silently
 * dropped, even though this is the exact event `webhook.ts` /
 * `chat.ts` listen for in 'responseNode' mode. Also relayed to the
 * canvas so a "Respond to Webhook" node's firing is visible live, not
 * just used server-side to answer the HTTP request.
 */
const handleWebhookResponse: RealtimeStatusHandler = (io, ownerId, event) => {
  io.to(broadcastRooms(ownerId, event.workflowId)).emit('node:webhook-response', event);
};

export default handleWebhookResponse;
