# FlowForge Fix Plan — Progress Tracker

Source plan: `n8n-reference-audit.md` fix plan (6 fixes, priority-ordered).
This file is the resumable state — read this FIRST in any follow-up
session, before re-reading the original plan, so work isn't repeated or
lost.

**IMPORTANT — could not verify by running anything.** This container has
no network access, so `npm install` / `pnpm install` could not run and
`tsc --noEmit` could not be executed against the actual dependency tree.
Every change below is hand-verified by reading surrounding code and
tracing types manually, NOT by compiling or running tests. **The
verification gate in the original plan (tsc across all 3 packages, the
3-node test workflow, docs/integration-progress.md update) has NOT been
done and must be done first in the next session**, ideally in an
environment with network access.

---

## FIX 1 — Chat test path — ✅ DONE

- `apps/api/src/routes/chat.ts`: added `chatRouter.post('/test/:workflowId/:path', ...)`
  mirroring `webhook.ts`'s test route — skips `isActive`, queries
  `nodesJson` (draft), otherwise identical to the production route.
- Threaded a new `isWorkflowActive` prop: `CanvasPage.tsx` (has `isActive`
  state already) → `NodeConfigPanel.tsx` → `Paramform.tsx`.
- `WebhookGuidedExtras` and `ChatGuidedExtras` in `Paramform.tsx` now
  build `/webhook/test/...` or `/chat/test/...` URLs when
  `!isWorkflowActive`, with a short explanatory line under the URL.
- Removed the stale "workflow must be active — inactive workflows return
  403" help text under the chat URL preview (no longer true for the test
  path).

**Not done**: no functional test was run (would need a running API +
Postgres). Worth a manual check: unpublished workflow with a
`chatTrigger` node, POST to `/chat/test/:workflowId/:path`, confirm 200
instead of 403.

---

## FIX 2 & 3 — Realtime events — ✅ DONE (combined; same root file)

These two turned out to share one cause (the switch statement in
`apps/api/src/realtime/socket.ts`), so both were fixed in the same pass.

- New: `apps/api/src/realtime/handlers/{types,started,running,success,
  failed,skipped,completed,cancelled,paused,webhookResponse,index}.ts`
  — one handler function per worker-published status (n8n's pattern),
  registered in a `Record<string, RealtimeStatusHandler>` map in
  `index.ts`.
- Every handler broadcasts via `io.to([user:${ownerId}, workflow:${id}])`
  — `broadcastRooms()` in `types.ts` — which fixes Fix 3 (was owner-only
  before) for every status at once, since `io.to()` accepts an array and
  Socket.IO dedupes per-socket automatically (no double-fire for a
  socket that's in both rooms, e.g. the owner viewing their own canvas).
- Added `paused` and `webhook-response` handlers, which is Fix 2 — these
  statuses were already correctly emitted by `executor.ts` (confirmed:
  `StatusEmitter`'s status union already included both) and published by
  `publisher.ts`, they just had no relay case before.
- `socket.ts` now dispatches through `realtimeStatusHandlers[event.status]`
  and `console.warn`s on an unrecognized status instead of silently
  dropping it — so a future new status can't disappear the same way.
- Frontend: `CanvasPage.tsx` — added `socket.on('execution:paused', ...)`
  (sets a "paused" run banner + marks the node `'paused'` if `nodeId`
  present) and `socket.on('node:webhook-response', ...)` (marks the node
  `'success'` with the response output, toasts).
- `FlowNode.tsx` — added `'paused'` to the `NodeStatus` union and its
  ring color (`ring-amber`, no pulse, to distinguish from `'running'`).

**Not done**: no live two-browser-tab test of Fix 3, no live pause/resume
test of Fix 2. Both are plausible from reading the code paths but
unverified end-to-end.

---

## FIX 4 — Expression engine — ✅ MOSTLY DONE

- Rewrote `apps/worker/src/engine/expressions.ts` entirely.
  Expressions are now evaluated as real JavaScript inside a fresh
  `isolated-vm` isolate per `{{ ... }}` block (same sandbox tech as
  `codeNode.ts` — reused the same JSON-bridge-in / no-live-references
  pattern, not a new dependency).
  - Globals inside the sandbox: `$json`, `$item`, `$env`, `$vars`,
    `$staticData`, `$binary`, `$workflow`, `$execution`, `$now`,
    `$today`, and `$node[...]` (kept as a `Proxy`, NOT a function call,
    specifically so existing `$node["Label"].json.field` expressions in
    already-saved workflows keep working unchanged).
  - `$node[...]` resolves by label first, then falls back to node id
    (new `nodesById` field on `ExpressionContext`, populated in
    `executor.ts` alongside the existing `nodesByLabel`).
  - `$fn.<namespace>.<fn>(...)` helper library (date/string/math/random/
    hash/json) preserved with identical behavior, now invoked as real
    function calls via a `Proxy` + a bridged native callback, instead of
    positionally regex-parsed comma-split args. Same functions, same
    names, should be a drop-in behavioral match.
  - Distinct typed errors: `ExpressionError` with `type: 'timeout' |
    'memory' | 'syntax' | 'security' | 'runtime'`. Timeout is 500ms,
    memory cap 32MB per expression isolate (Code node uses 64MB/5s since
    it runs full user scripts, not single expressions — kept expressions
    tighter since there are usually many per node).
  - `resolveExpressions()` is now `async` (was synchronous) — the one
    caller (`executor.ts`) was already inside an `async function` so
    this was a straightforward `await` add, not a structural change.
  - Failed expressions no longer silently resolve to `undefined` with no
    trace: `resolveExpressions(..., { onError })` collects
    `{ param, message, type }` per failed expression (dot/bracket path
    into the params object, e.g. `headers.Authorization`), and the value
    still resolves to `undefined`/blank at that position (so the node
    doesn't hard-crash on one bad expression) but the error is now
    visible.
  - `executor.ts`: builds `nodesById` next to `nodesByLabel`, collects
    `expressionErrors` per node run, and attaches them to the `'success'`
    status emit (both the normal-success and continueOnFail-success
    paths) via a new `expressionErrors?: {...}[]` field added to
    `StatusEmitter`'s event type.
- Frontend duplicate-label handling (the other half of Fix 4, since
  `$node["Label"]` collisions are now more consequential with real
  lookups): `CanvasPage.tsx` — added `uniqueLabel()`, used in `addNode()`
  and `duplicateSelectedNode()` to auto-suffix (`"HTTP Request 2"`, etc.)
  instead of allowing two nodes with the same label. `NodeConfigPanel.tsx`
  — the label `<input>`'s `onBlur` now also auto-suffixes against
  `otherNodeLabels` (already an existing prop) if the user manually
  renames into a collision.

**Not done / left for next session:**
- **No test run at all** — this is the highest-risk unverified change in
  the whole session, since it touches how every existing workflow's
  expressions evaluate. Before anything else next time: get `pnpm
  install` running (needs network), then hand-test at minimum:
  - `{{ $json.age > 18 ? 'adult' : 'minor' }}` and
    `{{ $json.name.toUpperCase() }}` (the plan's two examples)
  - an existing/representative workflow using
    `{{ $node["Some Label"].json.field }}` — bracket syntax must still
    work unchanged
  - `{{ $fn.date.format($now, 'YYYY-MM-DD') }}` or similar helper call
  - a deliberately broken expression (e.g. `{{ $json. }}` or referencing
    an undefined variable) — confirm it surfaces a typed error in
    `expressionErrors` on the emitted event rather than crashing the node
    or silently going blank with no trace
- **`expressionErrors` isn't wired into the UI yet.** It's on the wire
  (emitted from the worker, relayed by socket.ts, receivable in
  CanvasPage) but nothing in `NodeConfigPanel.tsx` / `Paramform.tsx`
  displays it. This is explicitly supposed to connect to Fix 6's
  `ExpressionEditorInput.tsx` per the original plan — since Fix 6 wasn't
  started, this display wiring wasn't done either. Cheapest next step
  short of full Fix 6: store `expressionErrors` on `FlowNodeData` (there
  should already be a `lastRunError` — add a sibling field) and render a
  small inline warning list in `NodeConfigPanel.tsx` under the raw JSON
  params view.
- **Performance not evaluated.** One fresh `isolated-vm` isolate per
  `{{ }}` block is noticeably heavier than the old regex matcher. For a
  node with many small expressions (e.g. 10 params each with one
  `{{$json.x}}`) this is 10 isolate spin-ups per node execution.
  Acceptable for correctness-first, but worth profiling — a pooled/reused
  isolate per node-execution (not per-expression) would be the natural
  optimization if this shows up as a bottleneck.
- Did NOT touch `credentialSchemas.ts` / OAuth2 refresh duplication —
  that's Fix 5, not Fix 4.

---

## FIX 5 — Param/credential schema drift — ❌ NOT STARTED

Nothing done. Per the plan: audit `paramSchemas.ts` (1043 lines) /
`credentialSchemas.ts` (657 lines) against `apps/worker/src/nodes/*.ts`
(60+ files) for drift, report mismatches, then decide whether to do the
long-term structural fix (shared schema definitions in
`packages/shared-types`) or just fix what's found. Audit-heavy — budget a
full session for this alone given the file count.

---

## FIX 6 — Input/output/expression editor UX — ❌ NOT STARTED

Nothing done: `executionStore.ts` (Zustand) extraction from
`CanvasPage.tsx`, `SchemaTreeView.tsx`, `ResourceLocatorInput.tsx`,
`ExpressionEditorInput.tsx` are all still to build. Correctly left for
last per the plan ("only after Fixes 1–5 are verified — otherwise built
on broken data"). Fix 4's `expressionErrors` plumbing (see above) is a
head start for `ExpressionEditorInput.tsx` specifically.

---

## Priority order for next session

1. **Get `pnpm install` running (needs network) and run the verification
   gate** — `tsc --noEmit` on all 3 packages, at minimum for Fix 4's
   rewritten `expressions.ts` and the socket.ts/handlers refactor, since
   neither has been type-checked, only hand-traced.
2. Hand-test Fix 4's expression engine against real saved workflows —
   see the bullet list above. This is the fix most likely to have a
   subtle bug (isolate bridging, Proxy semantics, the `$node[...]`
   backward-compat shim) and the one with the largest blast radius if
   wrong (every expression in every workflow).
3. Wire `expressionErrors` into the UI (cheap, high-value follow-up to
   Fix 4 already done).
4. Fix 5 (audit-heavy, do opportunistically per the original plan).
5. Fix 6 (only after 1–5 verified).
6. Update this file after each step — keep it as the single source of
   truth for what's actually done vs. claimed done, since the container
   can't run the verification gate itself right now.

## Files touched this session (for a quick diff review)

- `apps/api/src/routes/chat.ts`
- `apps/web/src/pages/CanvasPage.tsx`
- `apps/web/src/components/NodeConfigPanel.tsx`
- `apps/web/src/components/Paramform.tsx`
- `apps/web/src/components/FlowNode.tsx`
- `apps/api/src/realtime/socket.ts`
- `apps/api/src/realtime/handlers/*.ts` (new directory, 10 files)
- `apps/worker/src/engine/expressions.ts` (full rewrite)
- `apps/worker/src/engine/executor.ts`
