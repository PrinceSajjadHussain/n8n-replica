import axios from 'axios';

/**
 * wrapIntegrationError — normalizes axios failures from external-API nodes
 * into a single documented failure mode: timeout, auth (401/403), rate
 * limit (429), or a generic upstream error, each with an actionable message.
 * Used by the new PM/productivity/dev-infra nodes below so behavior is
 * consistent across ~15 new integrations instead of each one inventing its
 * own error string.
 *
 * Node plugins in this codebase throw (rather than return a structured
 * error item) on failure — the executor is responsible for turning a
 * thrown error into a failed-item/failed-run record. This helper keeps that
 * convention but makes the thrown message consistently diagnosable.
 */
export function wrapIntegrationError(nodeType: string, err: unknown): Error {
  if (axios.isAxiosError(err)) {
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return new Error(`${nodeType} node: request timed out.`);
    }
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      return new Error(
        `${nodeType} node: authentication failed (${status}) — check the credential attached to this node.`
      );
    }
    if (status === 429) {
      const retryAfter = err.response?.headers?.['retry-after'];
      return new Error(
        `${nodeType} node: rate limited (429)${retryAfter ? ` — retry after ${retryAfter}s` : ''}.`
      );
    }
    const detail = typeof err.response?.data === 'object' ? JSON.stringify(err.response?.data) : err.response?.data;
    return new Error(`${nodeType} node: request failed${status ? ` (${status})` : ''}${detail ? ` — ${detail}` : ''}`);
  }
  return err instanceof Error ? err : new Error(`${nodeType} node: unknown error`);
}
