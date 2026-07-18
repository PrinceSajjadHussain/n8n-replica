/**
 * Redacts likely-sensitive values before node input/output is persisted to
 * `ExecutionNodeRun`. Previously, raw JSON (including anything an upstream
 * API returned, or values pulled from a credential into a node's output)
 * was stored verbatim and shown in Execution History forever — a real
 * problem since API keys, tokens, and passwords regularly appear in HTTP
 * response bodies or get echoed back by nodes that build auth headers.
 *
 * This is deliberately a shallow, key-name-based heuristic rather than a
 * secret-scanning engine: it walks the object recursively and masks the
 * VALUE of any key whose name matches a common secret pattern, leaving
 * everything else (which is what makes debugging useful) untouched. It
 * can't catch a secret sitting under an innocuous key name — pair this
 * with not logging raw provider responses that embed credentials where
 * avoidable.
 */

const SENSITIVE_KEY_PATTERN =
  /(api[_-]?key|apikey|authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|secret|password|passwd|client[_-]?secret|private[_-]?key|credential|bearer|x-api-key|cookie|session[_-]?id)/i;

const MASK = '[REDACTED]';
const MAX_DEPTH = 10;

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = typeof val === 'string' || typeof val === 'number' ? MASK : redactValue(val, depth + 1);
    } else {
      out[key] = redactValue(val, depth + 1);
    }
  }
  return out;
}

/**
 * Redacts an object/array tree in place for persistence. Primitives and
 * `undefined`/`null` pass through unchanged (nothing to key off of at the
 * top level). Safe to call on already-redacted data (idempotent).
 */
export function redactForPersistence<T>(value: T): T {
  return redactValue(value, 0) as T;
}
