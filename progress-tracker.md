# FlowForge Fix Plan — Progress Tracker

Source plan: `n8n-reference-audit.md` fix plan (6 fixes, priority-ordered).
This file is the resumable state — read this FIRST in any follow-up
session, before re-reading the original plan, so work isn't repeated or
lost.

**UPDATE (this session) — verification gate has now actually been run.**
This container had network access to the npm registry, so `npm install`
ran successfully and `tsc --noEmit` / `tsc -b` were run for real against
all three packages (`api`, `worker`, `web`). Previously this had only
been hand-traced, never compiled. Findings:

- **10 real type errors were found and fixed**, none of them in the
  logic written for Fixes 1–4 themselves — all were pre-existing drift
  elsewhere in the codebase that a real compile catches immediately but
  hand-tracing can't:
  - `StatusEmitter`'s event type was missing a `binary` field that
    `executor.ts` was already emitting (3 call sites).
  - `NodeExecutionContext` gained `workflowId`/`workspaceId`/
    `staticData`/`setStaticData` at some point but two call sites never
    threaded them through: the single-node "test job" path in
    `apps/worker/src/index.ts` (now given safe no-op defaults, since
    test runs have no real workflow to scope to) and `agentNode.ts`'s
    `runTool`/`agentOrchestratorNode` (now properly forward the outer
    node's context instead of omitting it).
  - `createExecution`'s `triggerType` param was a hand-duplicated enum
    that had drifted from `ExecutionJobData['triggerType']` in
    shared-types (missing `rssTrigger`/`mqttTrigger`/`formTrigger`/
    `test`) — exactly the drift pattern Fix 5 warns about. Fixed by
    importing the shared type instead of re-declaring it.
  - Missing `@types/ssh2-sftp-client` — installed.
  - `splitOutNode.ts` accessed `.sourceNode` on a `pairedItem` that can
    also be an array — added narrowing.
  - A zod typing quirk (`z.unknown().optional().default({})` doesn't
    remove optionality in the inferred type) broke `workflowTests.ts` —
    fixed with explicit fallbacks.
  - `NodeInspectPopover`'s status type was never updated to include
    `'paused'` after Fix 2/3 added it to `NodeStatus` — fixed, with its
    own amber color treatment matching `FlowNode.tsx`'s ring.
- **`apps/api`, `apps/worker`, `apps/web` all now `tsc` clean.**
- **Fix 4's expression engine was hand-tested against a real standalone
  script** exercising the actual `resolveExpressions()`/`ExpressionContext`
  from `expressions.ts` (not mocked). All scenarios passed:
  ternary, method calls (`.toUpperCase()`), `$node["Label"]` bracket
  syntax (backward-compat), `$node[id]` fallback, `$fn.date.format(...)`,
  `$env`, `$vars`, `$staticData`, a template with surrounding text, and
  three deliberately-broken cases (syntax error, undefined-variable
  runtime error, infinite loop) — all three correctly produced typed
  `ExpressionError`s (`syntax`/`runtime`/`timeout`) instead of crashing
  or silently going blank.
- **`expressionErrors` is now wired into the UI**: `FlowNodeData` gained
  `lastRunExpressionErrors`, `CanvasPage.tsx`'s `node:completed` handler
  populates it from the event, and `NodeInspectPopover.tsx` renders it as
  a small inline warning list (param path, message, error type) below the
  raw JSON output view.

**Still not done, still needs a real running stack:** the 3-node
Chat → transform → action test workflow from the plan's verification
gate (needs Postgres/Redis/a live worker+API, not just `tsc`), and the
live two-browser-tab test for Fix 3 / pause-resume test for Fix 2. Those
require infra this container still doesn't have (Postgres/Redis
services), only npm registry access.

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
- ~~No test run at all~~ — **now done** (this session): hand-tested via
  a standalone script against the real `expressions.ts` module (see
  header note above). All scenarios from the plan's verify step passed,
  plus backward-compat and typed-error cases.
- ~~`expressionErrors` isn't wired into the UI yet~~ — **now done** (this
  session): `FlowNodeData.lastRunExpressionErrors` → populated in
  `CanvasPage.tsx` → rendered in `NodeInspectPopover.tsx`.
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

1. ~~Get `pnpm install` running and run the verification gate~~ — **done
   this session**, using `npm` (the actual package manager per
   `package.json`, not `pnpm`) with real registry access. All 3 packages
   `tsc` clean.
2. ~~Hand-test Fix 4's expression engine~~ — **done this session**
   against the real module. Still not tested: an actual
   previously-saved production workflow's real expressions (only
   synthetic test cases were run) — worth a spot-check once there's a
   real Postgres with real workflow data.
3. ~~Wire `expressionErrors` into the UI~~ — **done this session.**
4. Fix 5 (audit-heavy, do opportunistically per the original plan) —
   still not started.
5. Fix 6 (only after 1–5 verified) — still not started.
6. The plan's actual runtime verification gate (3-node Chat → transform
   → action test workflow, run via the Run button and via the Fix-1 test
   endpoint) still needs a live Postgres + Redis + running worker/api —
   this container has npm registry access but not those services. Do
   this first in an environment that has them.
7. Live two-browser-tab test for Fix 3, live pause/resume test for Fix 2
   — same infra requirement as #6.
8. Update this file after each step.

## Files touched this session (for a quick diff review)

Previous session:
- `apps/api/src/routes/chat.ts`
- `apps/web/src/pages/CanvasPage.tsx`
- `apps/web/src/components/NodeConfigPanel.tsx`
- `apps/web/src/components/Paramform.tsx`
- `apps/web/src/components/FlowNode.tsx`
- `apps/api/src/realtime/socket.ts`
- `apps/api/src/realtime/handlers/*.ts` (new directory, 10 files)
- `apps/worker/src/engine/expressions.ts` (full rewrite)
- `apps/worker/src/engine/executor.ts`

This session (verification gate + fixes found by it + UI wiring):
- `apps/worker/src/engine/executor.ts` — added `binary` to `StatusEmitter`.
- `apps/worker/src/index.ts` — safe defaults for `NodeExecutionContext`'s
  new required fields in the single-node test-job path.
- `apps/worker/src/nodes/agentNode.ts` — thread `workflowId`/`workspaceId`/
  `staticData`/`setStaticData` through `runTool` and
  `agentOrchestratorNode`'s sub-agent stages.
- `apps/worker/src/db/executions.ts` — `createExecution`'s `triggerType`
  now imports the shared `ExecutionJobData['triggerType']` type instead
  of a hand-duplicated, drifted copy.
- `apps/worker/src/nodes/splitOutNode.ts` — narrow `pairedItem` before
  reading `.sourceNode` (it can be an array).
- `apps/worker/package.json` — added `@types/ssh2-sftp-client`.
- `apps/api/src/routes/workflowTests.ts` — explicit fallbacks for a zod
  optional/default typing quirk.
- `apps/web/src/components/NodeInspectPopover.tsx` — added `'paused'` to
  the status union + its color; added `expressionErrors` field + inline
  warning-list rendering.
- `apps/web/src/components/FlowNode.tsx` — added `lastRunExpressionErrors`
  to `FlowNodeData`, passed into the inspect popover snapshot.
- `apps/web/src/pages/CanvasPage.tsx` — reset/populate
  `lastRunExpressionErrors` on `execution:started` / `node:completed`.
