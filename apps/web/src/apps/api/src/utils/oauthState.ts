import { randomUUID } from 'crypto';

interface StateEntry {
  userId: string;
  provider: string;
  redirectFrontendUrl: string;
  createdAt: number;
}

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const states = new Map<string, StateEntry>();

function cleanup() {
  const now = Date.now();
  for (const [key, entry] of states) {
    if (now - entry.createdAt > STATE_TTL_MS) states.delete(key);
  }
}

export function createOAuthState(userId: string, provider: string, redirectFrontendUrl: string): string {
  cleanup();
  const state = randomUUID();
  states.set(state, { userId, provider, redirectFrontendUrl, createdAt: Date.now() });
  return state;
}

export function consumeOAuthState(state: string): StateEntry | null {
  cleanup();
  const entry = states.get(state);
  if (!entry) return null;
  states.delete(state); // one-time use
  return entry;
}
