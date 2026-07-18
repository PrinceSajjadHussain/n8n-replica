# FlowForge — Setup & Feature Guide

This is an honest map of what's real vs. what's a documented extension
point, plus step-by-step setup for every credential type and the new
AI/RAG/browser features.

## 0. Run it

```bash
cp .env.example .env
# fill in CREDENTIAL_ENCRYPTION_KEY (32-byte base64) and JWT secrets
docker compose up -d postgres redis
pnpm install
pnpm --filter @flowforge/api prisma migrate deploy   # or `migrate dev` first run
pnpm dev   # runs api + worker + web together (see root package.json)
```
Web UI: http://localhost:5173 · API: http://localhost:4000

## 1. What's real right now

| Node | Status | Notes |
|---|---|---|
| webhook, schedule | ✅ real | webhook exposes `/webhook/:workflowId/:path`; schedule uses cron via the scheduler service |
| httpRequest | ✅ real | actual outbound HTTP call via axios |
| if, merge, set, code | ✅ real | real branching/transform/sandboxed JS execution |
| slack | ✅ real | posts to a Slack Incoming Webhook URL |
| **openai** | ✅ real (new) | Chat Completions call, supports JSON mode |
| **ragIngest / ragQuery** | ✅ real (new) | OpenAI embeddings + cosine-similarity retrieval, optional grounded answer |
| **browserAutomation** | ✅ real (new) | drives actual headless Chrome via a companion service — see `docs/browser-automation.md` |
| **switch, subWorkflow, forEachBranch, waitForWebhook, humanApproval, wait, forEach** | ✅ real (new) | see §10 below |
| **discord, telegram, notion, github, postgres** | ✅ real (new) | real API/DB calls, see §2 for credentials |
| email | ⚠️ stub | throws a clear "not implemented" error; wire up nodemailer/SendGrid in `apps/worker/src/nodes/stubNodes.ts` |
| googleSheets | ⚠️ stub | wire up `googleapis` OAuth in the same file |

Turning a stub into a real integration is intentionally low-friction: the
plugin interface (`apps/worker/src/nodes/types.ts`) is the same for every
node type, so you copy `openaiNode.ts` or `slackNode.ts` as a template.

## 1a. OAuth2 "Connect with ..." + credential sharing/folders

The Credentials page now supports three things beyond static API keys:

- **OAuth2 connect buttons** — "Connect with Google / Slack / GitHub" on the
  Credentials page kicks off a standard authorization-code flow and stores the
  resulting access/refresh token as an encrypted credential automatically.
  To enable a provider, set its client id/secret in `.env` (see
  `.env.example`): `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`,
  `SLACK_OAUTH_CLIENT_ID`/`_SECRET`, `GITHUB_OAUTH_CLIENT_ID`/`_SECRET`, and
  make sure `API_PUBLIC_URL` matches the redirect URI registered with each
  provider (`{API_PUBLIC_URL}/credentials/oauth/<provider>/callback`).
  Buttons for unconfigured providers are shown disabled with a tooltip.
- **Test connection** — every credential row has a "Test connection" button
  that makes a minimal, side-effect-free request to the provider (or
  validates the shape of the secret when no live check exists) and records
  the result (`lastTestOk`, `lastTestMessage`, `lastTestedAt`).
- **Folders & sharing** — credentials can be filed into folders (owner-only),
  and the owner can share any credential with a teammate by email with
  either **use** (can select it in workflow nodes and run "Test connection")
  or **manage** (can also rename/move it) permission. Shared secrets are
  never exposed to the recipient — only the encrypted value is ever
  decrypted, and only inside the execution engine.

## 2. Credentials — how to add one, per integration

Open **Credentials** in the left nav → pick a **Type** → paste the JSON
below → **Save credential**. The value is encrypted at rest
(`CREDENTIAL_ENCRYPTION_KEY`) and never shown again after saving — only
the worker decrypts it at execution time.

| Type | JSON shape | Where to get it |
|---|---|---|
| `slack` | `{ "webhookUrl": "https://hooks.slack.com/services/..." }` | Slack app → Incoming Webhooks → Add New Webhook to Workspace |
| `httpBearer` | `{ "token": "..." }` | Any API's bearer/PAT token; used by `httpRequest` as `Authorization: Bearer <token>` |
| `openai` | `{ "apiKey": "sk-..." }` | platform.openai.com → API keys. Used by `openai`, `ragIngest`, `ragQuery`, and the ✨ AI-agent generator |
| `browserRunner` | `{ "baseUrl": "http://localhost:7900", "apiKey": "" }` | Only needed if you protected the browser-runner service with an API key |
| `smtp` (for the email stub, once implemented) | `{ "host": "...", "port": 587, "user": "...", "pass": "..." }` | Your SMTP provider (SendGrid, SES, Gmail app password, etc.) |
| `google` (for the googleSheets stub, once implemented) | `{ "accessToken": "..." }` or a service-account JSON | Google Cloud Console → OAuth client / service account with Sheets scope |
| `discord` | `{ "webhookUrl": "https://discord.com/api/webhooks/..." }` | Discord channel → Edit Channel → Integrations → Webhooks |
| `telegram` | `{ "botToken": "123:ABC..." }` | Message @BotFather on Telegram → /newbot |
| `notion` | `{ "apiKey": "secret_..." }` | notion.so/my-integrations → New integration, then share your database/page with it |
| `github` | `{ "token": "ghp_..." }` | GitHub → Settings → Developer settings → Personal access tokens |
| `postgres` | `{ "connectionString": "postgresql://user:pass@host:5432/db" }` | Your external Postgres instance (this is separate from FlowForge's own database) |

Attach a credential to a node from the **Configure node** panel on the
canvas → **Credential** dropdown (shown automatically for node types that
need one).

## 3. AI Agent — generate a workflow from a prompt

Click **✨ Generate with AI** in the canvas toolbar, describe the
automation in plain English, and submit. This calls
`POST /ai/generate-workflow` (`apps/api/src/routes/ai.ts`), which:
1. Uses your saved `openai` credential (or the server's `OPENAI_API_KEY`
   env var as a fallback).
2. Sends a system prompt describing every available node type and asks
   GPT to return a workflow graph as JSON (`response_format: json_object`).
3. Replaces the canvas with the generated nodes/edges — nothing is saved
   until you click **Save**, so you can review/edit first.
4. Credential IDs are never invented by the model — attach real
   credentials to the generated nodes yourself afterward.

Example prompts:
- *"When a webhook receives an order, check if total > 100, then post to
  Slack, otherwise log it via HTTP request."*
- *"Every day at 9am, query my RAG namespace 'faq' for pending questions
  and email a summary."*

## 4. RAG (Retrieval-Augmented Generation)

Two nodes, no extra infra required (stores embeddings as JSON on disk —
swap for pgvector/Pinecone/Qdrant in `apps/worker/src/nodes/ragNode.ts`
for production scale):

1. **ragIngest** — feed it documents (`params.text` or `params.documents`,
   or pipe upstream node output into it). It chunks, embeds
   (`text-embedding-3-small`), and appends to a namespace.
2. **ragQuery** — embeds a query, returns the top-K most similar chunks,
   and (if `answerWithModel: true`) asks GPT to answer using only that
   retrieved context, with citations like `[1]`.

Typical workflow: `webhook → ragIngest` (build a knowledge base) and,
separately, `webhook → ragQuery → slack` (answer questions grounded in
that knowledge base).

## 5. Browser automation (Selenium/Playwright-style)

See **[docs/browser-automation.md](docs/browser-automation.md)** for the
full guide: starting the companion service
(`docker compose --profile browser up -d browser-runner`), the step
schema (`click`/`type`/`waitFor`/`extractText`/`screenshot`), and how to
display the result screenshot in the UI. This node genuinely opens
Chromium and interacts with the page — it's not a mock.

**On the "open Chrome in an iframe" ask specifically:** a truly live,
click-through iframe of a remote browser needs a VNC/CDP streaming
bridge (e.g. `selenium/standalone-chrome-debug` + noVNC, or a hosted
service like Browserless/BrowserBase) — that's a different, heavier
piece of infrastructure than a job-queue worker should own. What's
shipped here is the practical middle ground used by real automation
tools: the node drives the browser headlessly and returns a screenshot
URL your UI can render in an `<img>` or `<iframe>` after each run. If you
want true live viewing, point `browser-runner`'s Dockerfile at
`selenium/standalone-chrome-debug` instead and iframe its noVNC URL
directly — the node's HTTP contract doesn't need to change.

## 6. Real-time execution view

Already implemented via Socket.IO (`apps/api/src/realtime/socket.ts` +
`CanvasPage.tsx`'s `execution:started` / `node:started` / `node:completed`
/ `node:failed` / `node:skipped` listeners) — node borders update live on
the canvas as a run progresses. No changes needed there; the new AI/RAG/
browser nodes participate in this automatically since they're normal
node plugins.

## 8. What's new in this round

Requested from the n8n/Make.com feature list — here's what's now real,
and what's explicitly deferred (with why):

**Execution engine**
- ✅ **Retry mechanism** — per-node, in the Configure panel ("Retry on
  failure", max attempts + delay). Implemented in `executor.ts`.
- ✅ **Continue on Fail** — per-node checkbox; downstream nodes still run
  and the error is passed through as output instead of aborting the branch.
- ✅ **Wait / Delay node** (`wait`) — pauses a branch for N seconds (capped
  at 5 min per run).
- ✅ **For Each / loop node** (`forEach`) — maps a JS function over an
  array in a real isolated-vm sandbox (same engine as the Code node).
  **Honest limit:** it's a single-node map, not a re-entrant "run these 3
  downstream nodes per item" loop — FlowForge's executor is a one-pass DAG
  walker. True per-item multi-node branching needs subgraph re-entry
  support, which is a bigger executor rewrite than fits here; it's the
  top item on the roadmap below.
- ⏳ Deferred: parallel branches (edges already fan out and run
  independently node-by-node, but there's no explicit "wait for N of M"
  join semantics beyond `merge`), dead-letter queue, workflow resume,
  execution replay, pin data, step debugger.

**Expression engine**
- ✅ Real implementation (`apps/worker/src/engine/expressions.ts`),
  applied to every node's params before execution: `{{$json.field}}`,
  `{{$node["Label"].json.field}}`, `{{$env.NAME}}`, `{{$now}}`,
  `{{$today}}`, `{{$workflow.id}}`, `{{$execution.id}}`, `{{$item.field}}`
  (inside forEach). Whole-value expressions preserve type (numbers,
  objects, arrays); mixed strings are spliced in as text.
- ⏳ Deferred: `date()/math()/string()/hash()` helper function library —
  straightforward to add as more branches in `evalExpr`, not done yet.

**New integrations** (real API calls, same plugin pattern):
Discord (webhook), Telegram (Bot API), Notion (pages/blocks/database
query), GitHub (issues/comments/file contents), Postgres (parameterized
query against an external DB). Each documents its credential shape in
`moreIntegrations.ts` and shows up in the node palette + config panel hints.

**UI**
- ✅ Undo/redo (Ctrl/Cmd+Z, Shift+Z or Ctrl+Y), duplicate node
  (Ctrl/Cmd+D), delete via Delete/Backspace, save via Ctrl/Cmd+S.
- ⏳ Deferred: sticky notes, node grouping, auto-layout, multi-select drag,
  command palette/search — all reasonable additions to `CanvasPage.tsx`
  but not implemented this round.

**Everything else on the big list** (multi-agent orchestration, 100+
integrations, hybrid search/reranking/multiple vector DBs for RAG,
workflow versioning/diff, collaboration/roles, marketplace, SSO/RBAC,
monitoring dashboards, custom node SDK, import/export to
Make.com/Zapier/LangGraph/CrewAI): genuinely out of scope for incremental
edits to a ~2,000-line codebase — each of those is itself a multi-week
project at a real automation company. The architecture here (plugin
registry + zod-validated JSON graph + Socket.IO status stream) is built
so any one of them can be added without touching the others; treat this
list as the prioritized backlog, in the order suggested in the original
roadmap (execution engine → live view → expressions → credentials →
browser automation → agents → RAG → integrations → collaboration/enterprise).

## 10. Phase 1 — Core execution engine (this round)

**Real, architectural changes to the executor** (`apps/worker/src/engine/executor.ts`):

- ✅ **Parallel branch execution** — the executor now groups nodes into
  dependency "levels" and runs every node in a level with `Promise.all`,
  so independent branches genuinely execute concurrently instead of one
  at a time.
- ✅ **Merge (wait for multiple branches)** — falls out of the level
  scheduler for free: a node can't start until every incoming edge's
  source level has finished.
- ✅ **Switch / Router node** (`switch`) — n8n-style multi-case branching;
  matches `field` against a list of `{handle, value}` cases and follows
  only the matching edge (`sourceHandle`), with an optional `default` branch.
- ✅ **Sub-workflows / Execute Workflow node** (`subWorkflow`) — really
  calls another saved workflow end-to-end as its own nested Execution row
  (so it shows up in that workflow's history too), passing this node's
  input as the trigger payload. Depth-limited to 5 to catch A→B→A cycles.
- ✅ **True For Each (`forEachBranch`) + nested loops** — unlike the
  earlier `forEach` (a single-node array map), this runs a **whole
  embedded mini-workflow** (`params.subgraph = {nodes, edges}`) once per
  item, through the same level-based engine — so a `forEachBranch` inside
  that subgraph gives you real nested loops. `parallel: true` runs all
  items' subgraphs concurrently instead of sequentially.
- ✅ **Break / Continue** — inside a `forEachBranch` subgraph, a leaf
  node whose output is `{ "__break": true }` stops the loop after that
  item; `{ "__skip": true }` excludes that item's result but keeps going.
- ✅ **Wait for Webhook** (`waitForWebhook`) and **Human Approval**
  (`humanApproval`) nodes — genuinely **pause** the execution: the run
  stops, its full state (every node's output/status so far) is written to
  the `Execution.checkpoint` JSONB column in Postgres, and the execution
  row's status becomes `paused`. Nothing is held in worker memory.
  - Resume it externally: `POST /webhook-resume/:token` (public, no
    auth — the token from the paused node's live output IS the
    credential, same pattern as the trigger webhook).
  - Resume it from the UI/API: `POST /executions/:id/approve` or
    `/reject` (for `humanApproval` — sets `branch` true/false
    accordingly) or the generic `/executions/:id/resume` with any JSON
    body as the resumed value. List your pending approvals with
    `GET /executions/pending/approvals`.
- ✅ **Pause/resume survives worker restarts** — because the checkpoint
  is a Postgres row, not a live promise/process, resuming works even if
  the worker that started the run isn't the one that resumes it (or was
  restarted in between). This is what "scheduled resume after restart"
  and "execution checkpoints" meant in practice here.
- ✅ **Queue-based execution** — already existed (BullMQ), now also
  carries `resume` jobs on the same queue alongside `execute` jobs.

**Honest limitations, explicitly not solved this round:**
- **Pausing inside a `forEachBranch`/`subWorkflow`** isn't supported —
  there's no standalone `Execution` row to checkpoint against inside a
  nested/looped subgraph, so a `waitForWebhook`/`humanApproval` node used
  there fails fast with a clear error instead of silently hanging.
- **Transaction-safe execution** in the full sense (atomic multi-node
  sagas with automatic rollback/compensation) isn't implemented — each
  node's own side effects (an HTTP call, a Slack post) aren't undoable by
  FlowForge itself. What you get today: retries, continue-on-fail, and
  checkpointed pause/resume, which cover most reliability needs; true
  saga/compensation semantics would be a deliberate follow-up (idempotency
  keys per node + an outbox table).
- **Dead-letter execution / execution replay / pin data / step debugger**
  are still not implemented — the `ExecutionNodeRun` table already
  records every node's input/output/error per run, which is the data
  model replay would build on, but the replay-from-here UI/API isn't built.

## 12. Developer/debugging cluster (this round, chunk 1 of 2)

Picked as the next highest-value cluster: things that make building and
troubleshooting workflows less painful, all real:

- ✅ **Expression helper function library** — `{{$fn.<namespace>.<fn>(args)}}`
  inside any string param, alongside the existing `$json`/`$env`/`$node`
  expressions:
  - `$fn.date.format(ts, "YYYY-MM-DD")`, `.addDays`, `.addHours`, `.diffDays`, `.iso`, `.unix`, `.dayOfWeek`
  - `$fn.string.upper/lower/trim/slice/replace/split/includes/padStart/length/capitalize`
  - `$fn.math.round/floor/ceil/abs/max/min/sum/avg/random`
  - `$fn.random.uuid()`, `$fn.random.int()`
  - `$fn.hash.sha256/md5/base64encode/base64decode`
  - `$fn.json.parse/stringify`
  - Args are comma-separated; each is resolved as a nested `$...` expression, a JSON literal, or a plain string. Implemented in `apps/worker/src/engine/expressions.ts`.
- ✅ **Pin Data** — a "Pin data" checkbox on any node in the config panel
  freezes its output (`isPinned` + `pinnedOutput` on the node). While
  pinned, the executor skips the real plugin call *and* any credential
  use entirely and just replays the frozen value — exactly n8n's pin-data
  workflow of building downstream logic against a known-good sample
  without hammering a real API.
- ✅ **Test node (manual single-node execution)** — a "▶ Run this node in
  isolation" button in the config panel runs just that node type with
  whatever params/credential are currently set and a JSON mock input you
  provide, showing the raw output — with a one-click "📌 Pin this output"
  after. No workflow save, no Execution row created. Implemented as a
  `testNode` BullMQ job (`POST /nodes/test-run`) so it reuses the same
  worker process/credential decryption as real runs, without a temporary
  workflow existing in the DB.

**Deliberately not done in this chunk** (queued for chunk 2 or later):
execution replay / retry-from-node, execution dashboard/metrics, binary
data as a first-class type, item-pairing semantics.

## 14. Developer/debugging cluster, chunk 2 of 2 — execution replay + dashboard

- ✅ **Execution replay ("Retry from this node")** — in the Execution
  History view, expand any node in a past run and click **↻ Retry from
  here**. This creates a **new** Execution (visible alongside the
  original) that reuses every other node's recorded output and only
  re-executes the node you picked plus everything downstream of it — so
  a flaky Slack call three steps in doesn't force you to re-send the
  upstream emails/HTTP calls too. Runs against the workflow's *current*
  saved definition (FlowForge doesn't version workflow definitions yet,
  so this reflects any edits made since that run — noted honestly rather
  than silently pretending otherwise).
  API: `POST /executions/:id/retry-from/:nodeId`.
- ✅ **Basic execution dashboard** — success rate, average runtime,
  succeeded/failed/paused/running counts, and the 10 most recent failures
  (with their node-level errors), computed straight from the `Execution`
  table — no separate metrics store. Shown as a stat strip at the top of
  the Execution History page. API: `GET /executions/workflow/:workflowId/stats`.

**Still not done** (bigger lifts, noted for a future round): a
cross-workflow dashboard (this is per-workflow only), alerting/notifications
on failure, and CPU/memory metrics (those need infra-level monitoring,
not just Postgres queries).

## 13. Adding more integrations

Every integration follows the same recipe (see the template comment at
the top of `apps/worker/src/nodes/types.ts`):
1. Create `apps/worker/src/nodes/<name>Node.ts`, implement `execute()`.
2. `registerNode(...)` at the bottom of the file.
3. Import it once in `apps/worker/src/nodes/index.ts`.
4. Add it to `NODE_CATALOG` in `apps/api/src/routes/ai.ts` so the AI
   agent knows it exists.
5. Add it to `AVAILABLE_NODES` in `apps/web/src/components/NodePalette.tsx`
   and a param hint in `NodeConfigPanel.tsx`.

No engine changes required — the executor discovers nodes purely by
`type` string via `NODE_REGISTRY`.
