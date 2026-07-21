/**
 * Unwraps a resourceLocator-shaped param value down to the plain ID string
 * node executors actually need.
 *
 * The web UI's ResourceLocatorInput (List/URL/ID picker — see
 * apps/web/src/components/ResourceLocatorInput.tsx) stores params for any
 * `type: 'resource'` field as `{ mode: 'list'|'url'|'id', value: string,
 * cachedResultName?: string }`, matching n8n's on-disk shape so the picker
 * can show the previously-selected name again after a reload. Executors
 * never need the mode or cached name — just the resolved ID/key — so every
 * node that reads a resourceLocator-backed param (trello listId/boardId,
 * jira projectKey, asana projectId, clickup listId, linear teamId, mongodb
 * collection, etc.) should read it through this helper instead of using the
 * raw param directly.
 *
 * Old workflows saved before this shape existed still have a plain string
 * in that param slot — passed through unchanged.
 */
export function rlValue(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'object' && raw !== null && 'value' in (raw as Record<string, unknown>)) {
    const v = String((raw as Record<string, unknown>).value ?? '');
    return v || undefined;
  }
  const s = String(raw);
  return s || undefined;
}
