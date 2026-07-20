import type { RealtimeStatusHandler } from './types';
import handleStarted from './started';
import handleRunning from './running';
import handleSuccess from './success';
import handleFailed from './failed';
import handleSkipped from './skipped';
import handleCompleted from './completed';
import handleCancelled from './cancelled';
import handlePaused from './paused';
import handleWebhookResponse from './webhookResponse';

export type { RealtimeStatusEvent } from './types';

/**
 * One entry per worker-published status. A status with no entry here is
 * a visible gap in this map (and should be caught by the
 * `unhandledStatuses` check in socket.ts), not a silent fallthrough.
 */
export const realtimeStatusHandlers: Record<string, RealtimeStatusHandler> = {
  started: handleStarted,
  running: handleRunning,
  success: handleSuccess,
  failed: handleFailed,
  skipped: handleSkipped,
  completed: handleCompleted,
  cancelled: handleCancelled,
  paused: handlePaused,
  'webhook-response': handleWebhookResponse,
};
