import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * wait — pauses execution for a fixed duration, then passes input through
 * unchanged. Capped at 5 minutes so a misconfigured node can't hang a
 * worker slot indefinitely; for longer waits, use `schedule` to split the
 * workflow into two triggered workflows instead.
 * params: { ms?: number, seconds?: number }
 */
const MAX_WAIT_MS = 5 * 60 * 1000;

export const waitNode: NodePlugin = {
  type: 'wait',
  async execute({ input, params }) {
    const requestedMs =
      params.ms != null ? Number(params.ms) : params.seconds != null ? Number(params.seconds) * 1000 : 1000;
    const ms = Math.max(0, Math.min(requestedMs, MAX_WAIT_MS));
    await new Promise((resolve) => setTimeout(resolve, ms));
    return { output: input };
  },
};

registerNode(waitNode);
