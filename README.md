# FlowForge

A full-stack workflow automation platform (n8n / Zapier / Make.com style) — drag-and-drop
canvas, real-time execution visualization, a wide integration catalog, tool-using AI
agents, RAG, draft/publish workflow versioning, and an installable community node
marketplace.

## Stack

- **Backend**: Node.js 20+, TypeScript, Express, PostgreSQL, Redis, BullMQ, Socket.IO,
  JWT auth, AES-256-GCM credential encryption, `isolated-vm` sandboxed Code node
- **Frontend**: React 19, Vite, `@xyflow/react` (React Flow), Zustand, TanStack Query,
  Tailwind CSS, Socket.IO client
- **Monorepo**: npm workspaces (`apps/api`, `apps/worker`, `apps/web`,
  `packages/shared-types`, `services/browser-runner`) — see `RUN_LOCALLY.md` for a full
  local/VS Code setup walkthrough

## Architecture

```
apps/api              -> REST API: auth, CRUD, credentials, versioning, marketplace,
                          enqueues execution jobs. Does NOT run workflow logic.
apps/worker           -> Separate process: pulls jobs from BullMQ, runs the execution
                          engine, registers all node plugins (built-in + community),
                          publishes real-time status via Redis pub/sub.
apps/web               -> React canvas + real-time execution viewer + credentials manager.
packages/shared-types -> Shared TypeScript types (WorkflowGraph, node/edge shapes, events).
services/browser-runner -> Optional headless-Chrome sidecar for the browserAutomation node.
```

The execution engine (`apps/worker/src/engine/executor.ts`) topologically sorts the
workflow graph, executes each node via its registered plugin, feeds outputs downstream
using an item-paired data model (json + binary + lineage, à la n8n), follows only the
matching branch of IF/Switch nodes (others are marked `skipped`), supports per-node retry
policies and `continueOnFail`, and isolates per-node failures so one bad node never
crashes the worker process or unrelated branches.

## Node plugin system

Every node type implements:

```ts
interface NodePlugin {
  type: string;
  execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult>;
}
```

`NodeExecutionContext` gives every node: legacy unwrapped `input`, full item-paired
`items`, this node's `params`, decrypted `credential`, and `getBinary`/`toBinary` helpers
for file/image/PDF attachments. See `apps/worker/src/nodes/types.ts` for the full
interface doc and a copy-paste template — adding a new built-in node means implementing
`execute()`, calling `registerNode()`, and importing the file once from
`apps/worker/src/nodes/index.ts`. No changes to the execution engine are required.

### Built-in node catalog

**Core / logic** — `webhook`, `schedule`, `httpRequest`, `if`, `switch`, `merge`, `set`,
`code` (sandboxed via `isolated-vm`), `wait`, `forEach` / `forEachBranch`,
`waitForWebhook`, `humanApproval`, `subWorkflow`, `respondToWebhook` (see "Webhook response
modes" below), `dataTableRead` / `dataTableWrite` (see "Data persistence primitives"
below), `fileExtract` / `fileConvert` (CSV/JSON/text ↔ items, see "Binary/file data
support" below)

**Triggers** — `webhook`, `schedule`, `emailTrigger` (real IMAP via `imapflow`, IDLE push
with polling fallback), `fileWatcher` (`fs.watch`), `databaseChange` (Postgres
LISTEN/NOTIFY), `streamTrigger` (Redis Streams consumer group, plus native Kafka and
RabbitMQ consumers registered the same way — see "Triggers beyond webhook/schedule" below)

**Messaging / collaboration** — `slack`, `discord`, `telegram`, `whatsapp` (Meta Cloud
API), `notion`, `github`

**Business / CRM / commerce** — `stripe`, `twilio` (SMS, WhatsApp via Twilio, voice
calls), `hubspot`, `salesforce`, `shopify`

**Cloud / productivity** — `awsS3` (hand-rolled SigV4 signer, no AWS SDK dependency),
`gmail`, `googleCalendar`, `googleSheets` *(stub — see below)*, `postgres` (arbitrary
external DB access from a workflow)

**AI / agents** — `openai` (chat completions), `agent` (tool-using agent with short-term +
long-term/vector memory), `agentMemory` (manual session memory read/write/clear/recall),
`agentOrchestrator` (planner → sub-agents → reviewer pipeline, shared memory, reasoning
trace)

**RAG** — `ragIngest`, `ragQuery`: real document loaders (PDF/DOCX/CSV/HTML/website
crawler/Google Drive/Notion/Confluence), fixed/token-aware/markdown-aware/semantic
chunking, pluggable vector store (JSON file / pgvector / Pinecone / Qdrant / Weaviate),
hybrid (BM25 + vector) search with reranking, metadata filtering, and a citation viewer —
see `docs/rag.md`

**Browser automation** — `browserAutomation` (drives the optional `browser-runner`
sidecar for real headless-Chrome scripting; see `docs/browser-automation.md`)

**Stubbed, with a clear extension pattern** — `email` (generic SMTP send),
`googleSheets` — see `apps/worker/src/nodes/stubNodes.ts`

### Community/marketplace nodes

Anything not in the catalog above can be added without touching this repo. A community
node is a plain npm package with a `flowforge` field in its `package.json`; install it
through the marketplace API and it's live in every worker within seconds, no restart.
Full author-facing SDK docs: `docs/community-nodes.md`.

```
GET    /marketplace?query=airtable   browse the curated index
POST   /marketplace/install          { "npmPackage": "flowforge-node-airtable", "version": "1.2.0" }
GET    /marketplace/installed        what's actually installed on this instance
DELETE /marketplace/:name            uninstall
```

A full UI for this lives at **Marketplace** in the sidebar
(`apps/web/src/pages/MarketplacePage.tsx`): browse/search the curated index, install with
an optional pinned npm version (leave blank for latest), see what's actually installed
with its version and node types, "Check for updates" (re-resolves `latest` and reports
whether it changed), and uninstall. Previously this was API-only with no frontend.

Installed nodes are namespaced `community.<packageName>.<nodeType>` so they can never
collide with (or shadow) a built-in node. Installing downloads the package's real npm
tarball — treat this the same as any other supply-chain surface (see the security note in
`docs/community-nodes.md`).

## AI agents

`apps/worker/src/nodes/agentNode.ts` implements four layers — full write-up with request
examples: `docs/ai-agents.md`.

- **Persistent memory, short-term + long-term** — `agentMemory` gives a session's turn
  history direct read/write/clear/recall control; every `agent` run also automatically
  replays the last `recentTurns` (short-term, verbatim) AND semantically recalls relevant
  older turns from the **entire** session history via OpenAI embeddings + cosine
  similarity (long-term/vector recall) — so a fact from 200 turns ago can resurface when
  it's relevant instead of just aging out of the context window. Both layers persist to
  disk (swap the read/write functions for Redis/Postgres in a multi-instance deployment).
- **Formal Tool abstraction** — any registered node (built-in or community) can be
  exposed to the model as a callable tool via an `AgentToolSpec`
  (`{ name, nodeType, description, parameters }`) — the agent dispatches the model's
  chosen tool call straight through `NODE_REGISTRY`, so a Slack/Notion/HTTP node becomes
  an agent tool with no bespoke integration code.
- **Multi-agent orchestration** — `agentOrchestrator`: a planner breaks a goal into
  subtasks, routes each to a named sub-agent (its own system prompt + tool set + shared
  memory session, so it inherits long-term recall too), then a reviewer stage synthesizes
  the sub-agent outputs into one final answer.
- **Reasoning trace visualization** — every `agent`/`agentOrchestrator` run returns a
  structured per-step `trace` (recall matches, tool calls with args/results, plan,
  final answer). `apps/web/src/components/AgentTraceViewer.tsx` renders it as a readable
  timeline in the node config panel's "Test node" result and in Execution History's
  per-node Output panel, with raw JSON one click away.

## Production-grade RAG

`ragIngest` / `ragQuery` (`apps/worker/src/nodes/ragNode.ts` + `apps/worker/src/nodes/rag/`)
implement a production-grade RAG pipeline: real document loaders (PDF, DOCX, CSV, HTML,
a same-domain website crawler, and Google Drive/Notion/Confluence connectors), smart
chunking (fixed-size, token-aware, markdown-aware with a heading breadcrumb, and
embedding-based semantic chunking), a pluggable vector store (JSON file by default, or
pgvector/Pinecone/Qdrant/Weaviate — same interface, swap via one param/env var), and
`ragQuery` hybrid search (BM25 keyword + vector via Reciprocal Rank Fusion) with optional
reranking (Cohere or an LLM-based fallback), metadata filtering, and a citation-ready
output rendered by `apps/web/src/components/CitationViewer.tsx`. Full reference,
per-loader/backend config, and examples: `docs/rag.md`.

## Workflow versioning

Every save creates an immutable `WorkflowVersion` row; the live/executing workflow reads
from a separate `publishedNodesJson`/`publishedEdgesJson` snapshot so editing a draft never
affects production runs until you explicitly publish.

```
POST /workflows/:id/versions                      save current editor state as a new draft
GET  /workflows/:id/versions                       list all versions (draft + published)
POST /workflows/:id/versions/:version/publish       make this version live
POST /workflows/:id/versions/:version/rollback       alias for publish — "go back to"
GET  /workflows/:id/versions/diff?from=1&to=3        id-keyed added/removed/changed nodes+edges
```

The canvas has a "Versions & Comments" panel (top-right toolbar button) with a tab that
lists every version, lets you publish/rollback with one click, and renders the diff
endpoint's output as an added/removed/changed list.

## Collaboration: workspaces, folders, roles, comments, activity log, alerts

Every user gets a personal `Workspace` on signup (backfilled for existing users by the
`00000000000005_versioning_collaboration` migration). Workspaces hold members with a role
(`owner` > `admin` > `editor` > `viewer`), folders for organizing workflows, and everything
below. `apps/api/src/middleware/permissions.ts` (`requireWorkspaceRole` /
`requireWorkflowRole`) gates every route by the caller's effective role, derived from
workspace membership or legacy direct ownership.

```
GET/POST      /workspaces                                    list / create workspaces
PATCH         /workspaces/:id                                 rename (admin+)
GET           /workspaces/:id/members                         list members + roles
POST          /workspaces/:id/members                         invite an existing user by email (admin+)
PATCH/DELETE  /workspaces/:id/members/:userId                 change role / remove (admin+)
GET/POST      /workspaces/:workspaceId/folders                 list / create folders (editor+ to create)
PATCH/DELETE  /workspaces/folders/:folderId                     rename / delete (editor+)
GET           /workspaces/:id/activity                         workspace-wide activity feed

GET/POST      /workflows/:id/comments                          view / leave a comment, optionally pinned to a nodeId
PATCH         /workflows/:id/comments/:commentId/resolve        mark resolved/reopened (editor+)
DELETE        /workflows/:id/comments/:commentId                delete your own comment
GET           /workflows/:id/activity                          per-workflow activity feed (created/updated/deleted/
                                                                 activated/execution failed/succeeded/etc.)
GET/POST      /workflows/:id/alerts                             list / configure failure & success notifications (editor+)
PATCH/DELETE  /workflows/:id/alerts/:alertId                    pause, retarget, or remove an alert (editor+)

GET/POST      /workspaces/:workspaceId/log-streams               list / register a workspace-wide operational log
                                                                 stream target (admin+ — see "Operations & collaboration
                                                                 polish" below)
PATCH/DELETE  /workspaces/:workspaceId/log-streams/:logStreamId  pause/retarget/remove a log stream target (admin+)
```

Alerts fire from the worker (`apps/worker/src/utils/alerts.ts`) right after an execution
finishes, for every `AlertConfig` row on that workflow with `onFailure`/`onSuccess`
matching the outcome. A failure/success is *always* written to `ActivityLog` (so it's
visible in the in-app Activity tab even with no channel configured); `webhook` alerts POST
a JSON payload to the target URL, and `email` alerts send via Resend or SendGrid if
`RESEND_API_KEY`/`SENDGRID_API_KEY` is set (see `.env.example`) — otherwise the email send
is skipped with a console warning, but the in-app record still happens.

The canvas' "Versions & Comments" panel has Comments, Alerts, and Activity tabs wired to
these endpoints. Workspace and member management now has a dedicated page at
`/workspaces` (`apps/web/src/pages/WorkspacesPage.tsx`, linked from the sidebar): switch
between workspaces you belong to, rename a workspace, invite existing users by email with
a role, change a member's role, or remove them — all gated the same way as the API
(`admin`+ for member changes, `owner`'s role can't be reassigned or removed). Folder
management still doesn't have a page yet — call `GET/POST /workspaces/:workspaceId/folders`
and `PATCH/DELETE /workspaces/folders/:folderId` directly for now.

### Workflow-level sharing & ownership transfer

Independent of workspace roles, a single workflow can now be shared directly with a
specific user (e.g. someone outside its workspace, or at a narrower/wider role than their
workspace membership would otherwise give them) via `WorkflowShare`
(`00000000000007_workflow_sharing_webhook_modes` migration) — the same pattern
`CredentialShare` already used for credentials, adapted to the `viewer`/`editor`/`admin`
role rank. `getWorkflowRole` (`apps/api/src/db/workspaces.ts`) now resolves a caller's
effective role as the *higher* of their workspace-membership role and any direct
`WorkflowShare` grant (the real owner, `Workflow.userId`, always wins outright).

```
GET     /workflows/:id/shares                      list direct shares (admin+)
POST    /workflows/:id/shares                       { email, role } — share with a user (admin+)
DELETE  /workflows/:id/shares/:userId                remove a share (admin+)
POST    /workflows/:id/transfer-ownership            { email } — make another user the real
                                                      owner (owner only); the previous owner is
                                                      kept on as an `admin` share so they don't
                                                      lose access outright
```

The canvas has a **Share** button (top toolbar) opening a modal to add/remove direct
shares by email and role, and a "Transfer ownership" form gated to the actual owner.

## Variables, tags, error workflows, and manual test payloads

Four core n8n primitives that were previously missing entirely:

**Variables (`$vars`)** — an instance-wide or workspace-scoped key/value store, referenced
in any node's params exactly like `$json`/`$env`: `{{$vars.API_BASE_URL}}`. A variable with
`workspaceId: null` is global (visible to every workflow); a workspace-scoped variable of
the same key wins for workflows in that workspace. Resolved once per top-level execution
(`getVariablesMapForWorkflow`) and threaded through nested `subWorkflow`/`forEachBranch`
runs, resumes, and retries.

```
GET/POST      /variables?workspaceId=...     list (global + workspace-scoped) / create
PATCH/DELETE  /variables/:id                 rename key or change value / delete
```

**Tags** — named labels, scoped to a workspace (or global), attached to workflows
many-to-many so they can be filtered in the workflow list (`GET /workflows?tag=<tagId>`).

```
GET/POST      /tags?workspaceId=...          list (global + workspace-scoped) / create
DELETE        /tags/:id                      delete a tag (detaches it from all workflows)
GET           /tags/workflows/:workflowId     tags on one workflow
PUT           /tags/workflows/:workflowId     replace a workflow's full tag set ({ tagIds: [] })
```

**Error Workflow** — set `errorWorkflowId` on a workflow (via `PUT /workflows/:id`) to
designate another workflow that auto-runs whenever *this* workflow's execution fails.
The error workflow receives `{ failedWorkflowId, executionId, errorMessage }` as its
manual trigger payload, and runs as its own top-level execution (visible in its own
execution history) — wired in alongside the existing alert dispatch in
`apps/worker/src/engine/executor.ts` (`dispatchErrorWorkflow`), covering the initial run,
`resumeExecution`, and `retryFromNode`. Self-referencing `errorWorkflowId` is ignored to
avoid infinite recursion; dispatch failures are logged, never thrown.

**Manual trigger test payload** — the JSON body used for the last manual "Run" of a
workflow is now persisted on the `Workflow` row (`lastManualTestPayload`), mirroring n8n's
canvas "test workflow" panel remembering your last input across editor sessions.

```
GET  /workflows/:id/test-payload    read the persisted payload
PUT  /workflows/:id/test-payload    overwrite it directly
POST /workflows/:id/execute         with a JSON body: runs + re-persists that body as the
                                     new "last" payload; with an empty body: replays the
                                     last persisted payload instead of running with `{}`
```



`apps/api/src/utils/` holds the poller/consumer processes that seed these trigger nodes'
`input` and enqueue an execution job — the trigger node itself is a no-op at execution
time, consistent with how `webhook`/`schedule` already worked:

- `emailPoller.ts` — real IMAP (`imapflow` + `mailparser`), IDLE push where supported
- `triggerPollers.ts` — Postgres `LISTEN`/`NOTIFY` (`databaseChange`), `fs.watch`
  (`fileWatcher`), and three interchangeable `streamTrigger` backends: Redis Streams
  (consumer groups), Kafka (`kafkajs`), and RabbitMQ (`amqplib`, manual ack with requeue)

None of these are wired to a management UI yet — call the `register*Trigger` functions
directly (e.g. from a workflow-activation hook) with the connection config for now.

## Webhook response modes

`apps/api/src/routes/webhook.ts` supports n8n's three webhook response modes, chosen via
the triggering `webhook` node's `params.responseMode` (defaults to `'immediately'` if
unset, so existing workflows keep their original behavior):

- **`immediately`** (default) — the HTTP request is acked the instant the execution job
  is enqueued, same as before this pass.
- **`lastNode`** — the HTTP connection is held open until the whole execution finishes,
  then responds with the workflow's final leaf-node output (or a 500 with the error if
  the run failed).
- **`responseNode`** — the HTTP connection is held open for a **`respondToWebhook`** node
  (palette: "Respond to Webhook") anywhere in the graph to answer explicitly with its own
  `statusCode`/`responseBody`/`responseHeaders` params; the rest of the workflow keeps
  running in the background afterward. If the workflow finishes without ever reaching one
  (e.g. a branch skipped it), it falls back to the `lastNode` behavior instead of hanging.

Both waiting modes give up after `WEBHOOK_RESPONSE_TIMEOUT_MS` (default 30000) and
respond `504` rather than holding the connection forever. Implementation notes:

- The API route pre-generates the execution's id and passes it through the BullMQ job
  as `presetExecutionId`; `executeWorkflow` (`apps/worker/src/engine/executor.ts`) now
  accepts that as an optional param and uses it as the `Execution` row's real id instead
  of always minting its own — this was previously a "placeholder" per an existing code
  comment (the manual `POST /workflows/:id/execute` route generated an id that the worker
  silently discarded and replaced), so it's now accurate for every trigger type, not just
  webhooks.
- The wait itself piggybacks on the existing Redis pub/sub status channel
  (`flowforge:execution-status`, already used for the real-time canvas) rather than a
  second queue or polling loop — the route subscribes for its executionId and resolves
  as soon as the right status event (`webhook-response` or `completed`) arrives.

## A note on the data layer

`prisma/schema.prisma` is the canonical schema (models, indexes, cascading deletes) and
`prisma/migrations/*/migration.sql` are the matching SQL migrations, applied in order:

1. `00000000000000_init` — core schema (users, workflows, executions, credentials)
2. `00000000000001_pause_resume` — human-approval / wait-for-webhook pause state
3. `00000000000002_oauth_sharing_folders` — OAuth credentials, workflow sharing, folders
4. `00000000000003_workflow_versioning` — draft/published versions, rollback
5. `00000000000004_community_nodes` — installed marketplace package tracking
6. `00000000000005_versioning_collaboration` — workspaces, members/roles, workflow folders,
   comments, activity log, alert configs (backfills a personal workspace for existing users)
7. `00000000000006_variables_tags_error_workflow` — global/workspace `Variable` store
   (`$vars`), `Tag`/`WorkflowTag` many-to-many, `Workflow.errorWorkflowId`, and
   `Workflow.lastManualTestPayload`
8. `00000000000007_workflow_sharing_webhook_modes` — `WorkflowShare` (direct per-user
   workflow sharing, independent of workspace roles; see "Workflow-level sharing &
   ownership transfer" above)
9. `00000000000008_data_tables_static_data` — `DataTable`/`DataTableRow` (Phase 7's
   built-in key-value/tabular store) and `Workflow.staticData`
10. `00000000000009_workflow_test_cases` — `WorkflowTestCase` (Phase 9's saved test
    inputs/expected-outputs + scorer config)

The application code queries via `pg` directly (see `apps/api/src/db/*.ts` and
`apps/worker/src/db/*.ts`) rather than the generated Prisma Client, because this was
built in a sandboxed environment that could not reach `binaries.prisma.sh` to download
Prisma's engine binaries. If you have normal internet access, running
`npx prisma generate` will produce a working `@prisma/client` you can swap in — the
query shapes in the repository files map directly to Prisma Client calls with the same
names.

## Getting started

### 1. Environment

```bash
cp .env.example .env
# fill in real values, especially:
#   JWT_ACCESS_SECRET / JWT_REFRESH_SECRET (long random strings)
#   CREDENTIAL_ENCRYPTION_KEY (base64-encoded 32 bytes, e.g.:
#     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
#   COMMUNITY_NODES_DIR (shared volume path, default /data/community-nodes — must be
#     the SAME path mounted into both api and worker containers)
```

### 2. Run everything with Docker Compose

```bash
docker compose up --build
```

This boots Postgres, Redis, the API (`:4000`), the worker, and the web app (`:5173`).
Bring up the optional browser-automation sidecar explicitly with
`docker compose --profile browser up -d`.

### 3. Apply the database schema

The first time, apply all migrations in order to the fresh Postgres container:

```bash
npm run prisma:migrate:deploy
```

(Runs `prisma migrate deploy` inside `apps/api`. If you don't have internet access for
Prisma's engine binaries, apply the raw SQL instead:
`for m in apps/api/prisma/migrations/*/migration.sql; do psql "$DATABASE_URL" -f "$m"; done`.)

### 4. Open the app

Visit `http://localhost:5173`, sign up, and start building.

## Running locally without Docker (or with Docker for just Postgres/Redis)

This repo is an **npm workspaces** monorepo (see `RUN_LOCALLY.md` for the full
walkthrough, including running it from VS Code with only Postgres/Redis in Docker):

```bash
npm install
docker compose up -d postgres redis   # or point DATABASE_URL/REDIS_URL at your own
npm run prisma:migrate:deploy
npm run build:shared-types
npm run build:node-sdk
npm run dev:api      # http://localhost:4000
npm run dev:worker
npm run dev:web      # http://localhost:5173
```

## Building a workflow

1. Open a workflow, drag nodes in from the left palette (built-in nodes plus anything
   installed from the marketplace) — use the search box at the top to filter by name,
   type, or category, or pick from **Recently used**.
2. Click a node to configure its `params` (JSON) and, for integrations, pick a saved
   credential from **Credentials**.
3. Connect nodes by dragging from the right handle to the next node's left handle. IF /
   Switch nodes have multiple output handles — connect each to a different downstream
   path.
4. **Save** to create a new draft version, then **Run** to trigger manually, or
   **Publish** to make that version live and enable its Webhook
   (`POST /webhook/:workflowId/:path`) or Schedule (cron) trigger.
5. Watch node status update live on the canvas as the execution runs, then check
   **History** for full per-node input/output JSON (including any agent reasoning trace).

## Extending with a new built-in node type

1. Copy the template in `apps/worker/src/nodes/types.ts`.
2. Implement `execute()`, call `registerNode(...)`.
3. Import your new file once from `apps/worker/src/nodes/index.ts`.
4. Add it to the palette list in `apps/web/src/components/NodePalette.tsx`.
5. Add its type string to the `NodeType` union in `packages/shared-types/src/index.ts`.

No changes to the execution engine are required. For a third-party integration you don't
want merged into core, publish it as a community node instead (see
`docs/community-nodes.md`) — same `NodePlugin` interface, installed at runtime.

## What's real vs. still open

This is a large, actively-growing codebase rather than a finished product. Current state,
honestly:

**Solid / production-shaped:** execution engine (item-paired data, retries, branching,
pause/resume), auth + credential encryption, webhook/schedule triggers (now with all
three n8n response modes — see "Webhook response modes" above), workflow
versioning (draft/publish/rollback/diff), the node plugin system, the community node
marketplace (real npm install/uninstall/update with version pinning + hot reload, now
with a full browse/search/manage UI at **Marketplace** — see "Community/marketplace
nodes" above), RAG (real loaders, smart
chunking, pluggable vector DBs, hybrid search + reranking — see "Production-grade RAG"
above and `docs/rag.md`), the core n8n primitives — global/workspace `$vars`
Variables, workflow Tags, designated Error Workflow, and a persisted manual-trigger test
payload (see "Variables, tags, error workflows, and manual test payloads" above), and
workflow-level sharing/ownership transfer (see "Workflow-level sharing & ownership
transfer" above). Pin
Data itself (`node.isPinned`/`pinnedOutput`) was already wired into the execution engine
and persisted as part of the normal workflow save — there's just no *dedicated*
set/clear-pin endpoint separate from a full `PUT /workflows/:id` yet. The node palette
(left sidebar in the canvas) now has search-as-you-type (substring match, falling back to
fuzzy subsequence match) plus a "Recently used" section persisted in `localStorage`, and
now renders every node as a colored icon tile (shared with the canvas node chrome via
`apps/web/src/lib/nodeTypeMeta.ts`) grouped by category, matching the Make.com/n8n-style
app picker. The credentials form covers all 10 credential types the built-in nodes
actually need (`slack`, `discord`, `telegram`, `notion`, `github`, `postgres`,
`httpBearer`, `email`, `googleSheets`, `openai` — previously only 5 of these had a real
form, so half the integration nodes had no way to get a working credential through the
UI at all) with real typed fields per credential type (masked password inputs, a
provider dropdown for email, etc., generated from a shared per-type field schema in
`apps/web/src/lib/credentialSchemas.ts`) instead of one generic JSON textarea for every
type — power users can still drop into a raw-JSON view via "Edit as raw JSON instead". A
node's config panel now shows a live-status credential picker (name + ✓/⚠ test-result
marker, grouped by matching type first) with an inline **"+ New credential…"** option and
a **"🔌 Test connection"** button, so setting up and verifying a node's credential no
longer requires leaving the canvas — see "Credential UX overhaul" below for the full
before/after. The execution log
viewer (per-node Input/Output panels in **Execution history**) has a Table / JSON /
Schema view toggle, matching n8n's inspector — Table flattens one level of keys/values,
Schema shows each field's runtime type, JSON is the original pretty-printed dump.

**Real but intentionally light:** the new email/DB/file/stream triggers (functional
pollers, no management UI yet), the AI agent layer (real tool use + short/long-term
memory + multi-agent orchestration + reasoning-trace UI — see "AI agents" above and
`docs/ai-agents.md` — memory/vector-recall storage is still the JSON-on-disk store, not
yet switched over to the pluggable vector-store layer RAG now uses). Variables and Error
Workflow now have dedicated UI (see "Environment variables & version history UI (Phase 6
depth pass)" below); Tags now have a dedicated filter/create/attach UI on
**Workflows** (see "Design system upgrade & n8n/Make.com feature parity (Phase 5 depth
pass)" below) — test-payload is still real API + engine wiring with no dedicated panel
yet — call the endpoint directly for now (same status as folders in the collaboration
section).

**Not started:** SSO/LDAP/SAML/RBAC/audit logs/rate limiting, a custom-node SDK CLI +
hot-reload dev workflow (the marketplace covers *installing* community nodes; there's no
scaffolding tool for *authoring* one yet), import from n8n/Make/Zapier, export to
LangGraph/CrewAI/Docker/Python. UI polish continues incrementally — auto-layout, mini-map,
command palette, and a template gallery are done (see "Visual & catalog quality pass"
below); a shared `FilterPillGroup`/`SegmentedToggle`/`Badge`/`Card`/`Button` component set
now exists and is used on several pages (see "Design system upgrade & n8n/Make.com
feature parity (Phase 5 depth pass)" below), but migrating every remaining page and doing
the full elevation/motion/spacing/responsive sweep called for in that phase is still
partial — see that section's "Not done in this pass".

## Tests run during development (see delivery log)

- Postgres schema + cascading deletes (raw SQL round-trip)
- Auth: signup / duplicate / validation / login / wrong password / refresh / garbage token
- Workflow CRUD + cross-user ownership isolation
- Credential AES-256-GCM encryption verified at rest + round-trip decrypt
- Execution engine: IF-node branching (both directions), failed-node isolation (process
  survives, only the failed branch is marked failed/skipped)
- Real BullMQ worker process consuming jobs, including a genuine live HTTP call
  (`api.github.com`) captured with real response headers
- Webhook trigger: pre-activation block, correct path fires, wrong path 404s
- Schedule trigger: BullMQ repeatable job registration/removal verified directly in Redis
- Socket.IO real-time layer: JWT-authenticated handshake, rejection of bad tokens, full
  8-event sequence received by a mock client during a real 3-node execution
- Frontend: `tsc -b` zero errors, `vite build` clean production bundle, served build
  verified reachable with correct CORS from the API
- Final full round-trip: signup → create workflow → activate → trigger via webhook →
  worker executes real sandboxed Code node math (21 → 42) → DB row shows `success` with
  full per-node input/output trail

**Phase 3 depth pass (this round):** credentials form switched from one generic JSON
textarea to real per-type field schemas (`CredentialsPage.tsx`); node palette got
search-as-you-type + fuzzy fallback + a "Recently used" section (`NodePalette.tsx`);
execution log viewer got a Table / JSON / Schema toggle for per-node input/output
(`ExecutionHistoryPage.tsx`); the community node marketplace — previously API-only with
zero frontend — got a full page at `/marketplace` (browse/search, install with version
pinning, installed list, update check, uninstall), wired into routing and the sidebar
nav. Verified with a parser-level syntax check (TypeScript's source-file parser, via a
throwaway script) across every `.ts`/`.tsx` file in `apps/web`, `apps/api`, `apps/worker`,
and `packages/shared-types` — zero parse errors. Note: a full `pnpm install` + `tsc -b`
type-check could not be completed in this sandbox — pnpm 11 in this environment fails to
resolve the `@flowforge/shared-types` workspace dependency (404s against the public npm
registry instead of linking the local workspace package) even with
`link-workspace-packages`/`prefer-workspace-packages` set; this reproduces on a clean
`node_modules` wipe and is unrelated to the edits in this pass. Re-run `pnpm install &&
pnpm -F @flowforge/web build` in a normal dev environment to get full type-checking on
top of the syntax check already done here.

*(Note: the integration/agent/versioning/marketplace additions above were built and
reviewed for correctness against their respective SDKs/APIs, but have not been re-run
through the live end-to-end test suite described in this section — do that before
deploying any of it to production.)*

**Phase 4 depth pass (this round):** workflow-level sharing + ownership transfer
(`WorkflowShare` table, `GET/POST/DELETE /workflows/:id/shares`,
`POST /workflows/:id/transfer-ownership`, a **Share** modal on the canvas — see
"Workflow-level sharing & ownership transfer" above); webhook response modes
(`immediately`/`lastNode`/`responseNode`, a new `respondToWebhook` node — see "Webhook
response modes" above).

While verifying the sticky-note request for this pass ("sticky notes — verify freeform
text, not tied to node execution"), found and fixed a real bug: sticky notes (and group
containers) were being saved with `type: 'note'`/no type at all and reloaded as if they
were real `flowNode`s, and — because they have no edges and thus no incoming dependency —
the execution engine picked them up as level-0 root nodes and threw `No node plugin
registered for type "note"` on every run, marking the whole execution `failed` any time a
workflow had a sticky note on its canvas. Fixed at two layers: (1) the frontend
(`CanvasPage.tsx`) now saves sticky notes/groups with their real `stickyNote`/`group`
type, size, and parent/nesting info (so they also now survive a page reload, which they
silently didn't before either), and (2) the worker's executor now has a
`NON_EXECUTABLE_NODE_TYPES` filter that strips any `stickyNote`/`group` node (and edges
touching one) out of the graph before `computeLevels` runs, at every entry point
(top-level execution, resume, retry, sub-workflow, `forEachBranch`) — so this can't
regress even if a future frontend change reintroduces a bad payload shape.

Also, while implementing `responseNode`/`lastNode` webhook modes, found that
`ExecutionJobData.executionId` was already a dead field — a comment on it literally said
"placeholder; the worker creates the authoritative row" — because `createExecution`
always minted its own id, discarding the one the API route generated and returned to
callers. Needed a real fix (not a workaround) since the webhook route has to know the
execution's id *before* enqueueing, to subscribe for its status events without a race.
`createExecution`/`executeWorkflow` now accept an optional preset id and use it when
given; the worker passes `job.data.executionId` through for every trigger type, so this
also fixes the same latent issue for manual runs, not just webhooks.

Verified with the same parser-level syntax check as the Phase 3 pass (zero parse errors
across all 122 `.ts`/`.tsx` files in `apps/web`, `apps/api`, `apps/worker`, and
`packages/shared-types`). The same `pnpm install`/`tsc -b` limitation noted in the Phase 3
paragraph above still applies in this sandbox — re-run a full build in a normal dev
environment before deploying.

## Data persistence primitives (Phase 7 depth pass)

Gap: no built-in place for a workflow to persist simple state — every "remember the last
processed id" or "dedupe against what we've seen" use case required an external Postgres
credential. Added two primitives, both scoped honestly (workspace vs. per-workflow) rather
than conflated into one.

### Data Table — a built-in key-value/tabular store

- **Schema**: `DataTable` (workspace-scoped, user-defined `columns`) + `DataTableRow`
  (free-form JSONB `data`) — migration
  `00000000000008_data_tables_static_data`. Rows are matched/filtered via
  `data->>'col' = 'val'`, backed by a GIN index rather than per-column real columns, since
  the column set is user-defined and changes over time.
- **API**: `apps/api/src/routes/dataTables.ts` — table CRUD gated at workspace `admin`,
  row CRUD gated at workspace `editor`/`viewer` (mirrors the Variables permission model).
- **Worker nodes**: `apps/worker/src/nodes/dataTableNode.ts` — **Data Table: Get/List**
  (`mode: 'list' | 'get'`, optional `filterColumn`/`filterValue`) and **Data Table:
  Insert/Update/Delete** (`operation: 'insert' | 'update' | 'delete'`). Both resolve the
  table by `(workspaceId, tableName)` — the same "reference by name, not id" pattern
  credentials use — via `apps/worker/src/db/dataTables.ts`. Required adding `workflowId`/
  `workspaceId` to `NodeExecutionContext` (see `nodes/types.ts`) and threading
  `workspaceId` through the executor (`executeWorkflow`/`resumeExecution`/`retryFromNode`/
  `runForEachBranch` all now resolve and pass it down) — this is the one execution-engine
  change this phase required, per the standing constraint of only touching the engine when
  a phase explicitly needs a new field.
- **UI**: `apps/web/src/pages/DataTablesPage.tsx` at `/data-tables` — pick a workspace,
  pick a table, edit cells inline (blur-to-save), add/delete rows, create a table by
  typing a comma-separated column list. No bulk import/export or per-column type
  validation UI yet (`columns[].type` is stored and sent to the API but not yet enforced
  client-side beyond the identifier-format check on the name).

### Workflow static data — `$getWorkflowStaticData()`/`$setWorkflowStaticData()`

- **Schema**: `Workflow.staticData` (`JSONB DEFAULT '{}'`), same migration as above.
- **Read**: any node's params can reference `{{$staticData.KEY}}` (added to
  `engine/expressions.ts` alongside the existing `$vars` — same `getPath` mechanics,
  snapshotted once per top-level run, same as `$vars`).
- **Read/write**: the Code node (`apps/worker/src/nodes/codeNode.ts`) bridges
  `$getWorkflowStaticData()` (returns the snapshot) and `$setWorkflowStaticData(data)`
  into the `isolated-vm` sandbox via an `ivm.Reference` — the setter only records the
  replacement value inside the isolate; the actual Postgres write happens once, after the
  script finishes, so a script calling it in a loop doesn't hammer the DB. Deliberately a
  full-blob replacement (like `$vars`/`localStorage`), not a per-key patch — merge
  yourself first (`$setWorkflowStaticData({ ...$getWorkflowStaticData(), lastId: 42 })`)
  if you only want to change one field.
- Only the Code node can *write* it in this pass (matches the phase brief: "readable/
  writable from Code nodes and expressions" — expressions are read-only by construction in
  this engine, so the write path only ever made sense from Code). Other node types could
  gain write access later via the same `setStaticData` context field — it's already on
  `NodeExecutionContext` for any plugin that wants it.

### Verified

Parser-level syntax check across every file touched or added this pass (worker engine,
worker nodes, both `db/dataTables.ts` modules, API routes, frontend) — zero parse errors.
Same sandbox limitation as prior phases: no live `pnpm install`/`tsc -b` in this
environment (workspace-link resolution fails offline) — run `pnpm install && pnpm -r
build` before deploying. Also unverified end-to-end (no live Postgres in this sandbox):
the `DataTableRow` GIN-index filter query and the `isolated-vm` `Reference.applySync`
bridge should be exercised against a real DB/isolate before relying on them in production.

## Binary/file data support (Phase 8 depth pass)

Goal: a real file/attachment data type flowing between nodes (n8n's binary-data
convention), plus generic CSV/JSON/text conversion utilities and previews in the
inspector — rather than JSON-only items.

### What was already there vs. what this pass added

Tracing the item model before writing anything showed the binary *passthrough*
itself — `BinaryData`/`BinaryCollection` on `NodeItem` (`packages/shared-types`),
`getBinary()`/`toBinary()` on `NodeExecutionContext`, `{{$binary.*}}` expression support
(`engine/expressions.ts`), and metadata-only stripping for logs/expressions
(`engine/executor.ts`'s `stripBinaryData`) — were already fully implemented in an earlier
pass. What was actually missing, and what this pass built:

- **`apps/worker/src/nodes/fileNode.ts`** *(new)* — two generic utility nodes:
  - **Extract from File** (`fileExtract`) — reads a named binary property (default
    `"data"`) off each input item and parses it into item(s): `csv` → one output item per
    row (via the existing `csv-parse/sync` dependency, same as the RAG CSV loader),
    `json` → array-to-items / object-to-one-item, `text` → `{ text: <utf8 string> }`.
    `dropBinary: true` excludes the original attachment from the parsed items.
  - **Convert to File** (`fileConvert`) — flattens all input items' `json` into one
    binary attachment (`csv` via a small dependency-free writer with proper
    comma/quote/newline escaping, or `json`) on a single output item, ready to hand to
    `email`/`httpRequest`/`slack`/`respondToWebhook`.
  - Both registered in `apps/worker/src/nodes/index.ts`; `fileExtract`/`fileConvert`
    (and the previously-unlisted `dataTableRead`/`dataTableWrite`) added to the `NodeType`
    union in `packages/shared-types`.
- **Preview rendering** — `NodeStatusEvent` (`packages/shared-types`) gained an optional
  `binary` field. The executor now emits binary metadata alongside every `running`/
  `success` status event via a new `itemsToBinaryPreview` helper, which — for
  `image/*`/`application/pdf` attachments under a 512 KB cap — includes the actual
  base64 so the UI can render a real thumbnail, and metadata-only otherwise (keeping
  socket payloads small for everything else). Threaded through
  `CanvasPage.tsx` (`lastRunBinary` on node data) → `FlowNode.tsx` →
  `NodeInspectPopover.tsx`, which now renders a thumbnail for images, an "Open" link to a
  `data:` URL for small PDFs, or a generic file chip (name/mimeType/size) otherwise,
  above the existing Input/Output JSON view.
- **Palette + config panel** — added to `nodeTypeMeta.ts` (Data category) and
  `NodeConfigPanel.tsx`'s param hints.

### Not done in this pass

No dedicated binary-upload UI (a workflow gets binary data from an upstream node — HTTP
response, email attachment, RAG loader — not from a file picker on the canvas itself,
same as n8n). Large-file handling still inlines base64 in Postgres via the existing
`BinaryData.data`/`directRef` shape; `directRef` (an id into an external object store) was
already modeled for this but has no backing store wired up yet — still base64-only in
practice.

### Verified

Brace/paren-balance and manual read-through of every touched/added file (no live
`pnpm install`/`tsc -b` in this sandbox — same networking limitation as every prior phase;
`registry.npmjs.org` is reachable but the workspace `link:`/`workspace:*` protocol isn't
resolvable via plain `npm install`). Run `pnpm install && pnpm -r build` before deploying.

## Operations & collaboration polish (Phase 10 depth pass)

Four smaller pieces of production/collaboration polish, on top of what Phases 1-9 already
shipped:

**Workspace-wide execution log streaming.** `LogStreamConfig`
(`00000000000010_log_streams_presence` migration) is a new, separate table from the
per-workflow, finish-only `AlertConfig`: an org owner/admin registers a target URL once
per workspace, and every execution's `started`/`completed`/`failed` event across *every*
workflow in that workspace gets forwarded to it — meant for piping into Datadog, Sentry,
Slack, or a custom collector. Dispatch happens from the worker
(`dispatchLogStreamEvent` in `apps/worker/src/utils/alerts.ts`), fired at the same three
points in `apps/worker/src/engine/executor.ts` (`executeWorkflow`, `resumeExecution`,
`retryFromNode`) where the execution-status Socket.IO events already fire, filtered
per-target by its subscribed `eventTypes`. Configured from the Workspaces page
(`apps/web/src/components/LogStreamsPanel.tsx`), gated to `admin`+ the same way member
management is.

**Live presence: viewer avatars + cursors.** The Socket.IO server
(`apps/api/src/realtime/socket.ts`) now has a second room type,
`workflow:${workflowId}`, that any collaborator with canvas access can join — distinct
from the per-owner `user:${userId}` room used for execution-status events. Joining
broadcasts an updated viewer list (`presence:viewers`) with a stable per-user color, and
`presence:cursor` relays throttled (~60ms) cursor positions expressed as a 0-1 fraction of
the canvas pane's width/height, so positions stay meaningful across viewers with different
window sizes without needing the full ReactFlow screen→flow coordinate transform on the
server. The canvas page renders a Google-Docs-style avatar stack in the header and labeled
cursor dots over the pane. Presence state is in-memory per API process — fine for a single
instance; scaling the API horizontally would need this moved to Redis, same pattern as the
execution-status pub/sub.

**Switch node: visual case reordering + fallback toggle.** `switchNode.ts`
(`apps/worker/src/nodes/switchNode.ts`) always matched cases in array order, first match
wins, with an optional `default` fallback — but the only way to reorder or add cases was
hand-editing the raw params JSON. `SwitchCasesEditor.tsx`, embedded in `NodeConfigPanel`
above the JSON box for `switch` nodes, adds up/down buttons per case (order *is* priority),
add/remove, and an explicit toggle for whether the `default` fallback route is exposed.

**Marketplace: install-by-name + real update indicator.** The install endpoint
(`POST /marketplace/install`) already accepted any public npm package name — the gap was
that the UI only surfaced the curated index. `MarketplacePage.tsx` now has a direct
"Install by npm package name" form up top, plus a new `GET /marketplace/latest/:name`
endpoint that checks the latest published npm version *without* installing; "Check for
updates" on an installed package now shows a real `update available: vX` badge and a
separate `Update to vX` confirm button, instead of blindly reinstalling `latest` on click.



Goal: let a user save sample trigger inputs + expected outputs per workflow, run the
workflow against each case, and see pass/fail — plus a lightweight evaluation mode for
AI-heavy (agent/openai/RAG) workflows whose output won't be byte-identical between runs.

### What changed

- **Schema**: `WorkflowTestCase` (migration `00000000000009_workflow_test_cases`) — per-
  workflow `{ name, input, expectedOutput, scorer, passThreshold }`.
- **`apps/api/src/utils/testScoring.ts`** *(new)* — a plain function map (not a class
  hierarchy, so a new scorer is one more entry — the "pluggable scorer function" the
  phase brief asked for), with four scorers:
  - `jsonDiff` (default) — deep-equal structural comparison, with a shallow
    added/removed/changed diff for the results UI when it fails.
  - `exactString` — stringified output must equal `expectedOutput` exactly.
  - `contains` — stringified output must contain `expectedOutput` as a substring.
  - `similarity` — **the AI-evaluation-mode scorer**: dependency-free bag-of-words
    Jaccard similarity against a `passThreshold` (default 0.7), for scoring
    AI-generated text without an extra embeddings call per test run.
- **`apps/api/src/routes/workflowTests.ts`** *(new)* — CRUD for test cases
  (`GET/POST /workflows/:id/tests`, `PATCH/DELETE /workflows/:id/tests/:testId`) plus
  `POST /workflows/:id/tests/run` (optionally scoped to specific `testCaseIds`), which
  enqueues one real BullMQ execution per case (`triggerType: 'test'` — added to
  `ExecutionJobData` in `packages/shared-types` so these runs are distinguishable from
  manual/webhook/schedule runs in Execution History), waits for each via
  `job.waitUntilFinished` (same `QueueEvents` pattern `nodeTest.ts` already used for
  single-node test runs), and scores the workflow's final leaf output against the case's
  `expectedOutput`.
- **`apps/web/src/pages/WorkflowTestsPage.tsx`** *(new)*, at `/workflows/:id/tests` — add/
  edit/delete test cases (JSON input editor, scorer picker, a pass-threshold field that
  only appears for the `similarity` scorer), a "Run tests" button that runs every case (or
  "Run" on a single row), pass/fail badges, a passing-count summary, and an expected-vs-
  actual + diff view per result with a link through to that run's entry in Execution
  History. Linked from the canvas toolbar (next to History), the ⌘K command palette, and
  Execution History's header.

### Not done in this pass

Test cases run sequentially against the live (draft) graph, not the *published* version —
matches how manual "Run" already behaves, but means a test run doesn't independently
validate what's actually live if a workflow has unpublished draft changes. No CI/webhook
trigger for automatically re-running tests on save yet — call `POST .../tests/run`
yourself (e.g. from a pre-publish hook) for now. The `similarity` scorer is intentionally
simple (word-overlap, not semantic/embedding similarity) per the phase brief's "simple
string/JSON similarity to start" — swapping in a real embedding-based scorer later is a
drop-in addition to `SCORERS` in `testScoring.ts`.

### Verified

Brace/paren-balance check and manual read-through of every touched/added file. Same
sandbox limitation as every prior phase — no live `pnpm install`/`tsc -b`/`vitest` here;
run `pnpm install && pnpm -r build` (and add real test coverage for `testScoring.ts`'s
scorers and the run-endpoint's job-wait/scoring flow) before deploying.



Continuing the n8n/Make.com UI-parity pass. Scope: give the `$vars` variables system and
the (already-real) draft/publish version history a proper settings surface, and wire up
the Error Workflow field that existed in the schema/executor but had no UI.

### What changed

- **`apps/web/src/pages/VariablesPage.tsx`** *(new)* — settings page at `/variables`
  (added to `AppShell`'s nav and, via the shared `links` array, to the ⌘K command
  palette automatically). Lists instance-wide variables plus a per-workspace tab; create/
  edit/delete against the existing `apps/api/src/routes/variables.ts` endpoints (no API
  changes needed — they already supported everything this page needed). Values are
  masked behind a dot-mask by default with a per-row **Reveal** toggle, matching the
  credentials page's convention for anything secret-shaped. Workspace tabs show that
  workspace's own variables plus a read-only "inherited from instance" list so it's clear
  which `{{$vars.KEY}}` a workflow in that workspace will actually resolve to (workspace
  value wins on key collision, same precedence the worker already used).
- **`apps/web/src/components/CollabPanel.tsx`** — added a fifth **Settings** tab
  alongside the existing Versions/Comments/Alerts/Activity tabs (reusing that slide-over
  rather than adding a new modal). It has one control for now: a dropdown to pick this
  workflow's **Error workflow** from the user's other workflows, writing `errorWorkflowId`
  via the existing `PUT /workflows/:id` (already accepted this field — see
  `workflowUpdateSchema` in `apps/api/src/routes/workflows.ts` — it just had no UI path to
  set it). The tab documents exactly what the error workflow receives as its trigger
  payload — `{ failedWorkflowId, executionId, errorMessage }`, per
  `dispatchErrorWorkflow()` in `apps/worker/src/engine/executor.ts` — including the
  honest caveat that it does *not* get the failed node's own input/output inline; that
  has to be looked up via the Executions API using `executionId` if needed. The canvas
  toolbar button that opens this panel was renamed from "Versions & Comments" to
  "Versions, Comments & Settings" so the new tab is discoverable.
- **Version history itself needed no new work** — `CollabPanel`'s existing Versions tab
  already lists every draft/published `WorkflowVersion`, computes an added/removed/
  changed diff between any two versions via `GET /workflows/:id/versions/diff`, and can
  publish or roll back to any version. The Phase 6 brief asked for this as new work, but
  tracing it against `workflowVersionsRouter` and `CollabPanel.tsx` showed it was already
  shipped in an earlier pass — flagged here rather than rebuilt to avoid a duplicate,
  drifting second implementation.

### Verified

Parser-level syntax check (TypeScript's source-file parser) on every file touched or
added in this pass — zero parse errors. `pnpm install && pnpm -F @flowforge/web build`
still needed in a real dev environment for a full type-check (same sandbox networking
limitation noted in the Phase 3/4/5 passes above — this environment cannot resolve the
`@flowforge/shared-types` workspace link via `pnpm install`).

## Credential UX overhaul (Phase 5 depth pass)

Triggered by a concrete bug report: a node's credential dropdown always showed "None",
even after the user tried to attach one. Root-caused to two separate issues rather than
one bug:

1. **`CredentialsPage.tsx` only supported creating 5 of the 10 credential types** the
   built-in nodes actually read (`slack`, `httpBearer`, `email`, `googleSheets`, `openai`
   — but not `discord`, `telegram`, `notion`, `github`, or `postgres`, even though
   `moreIntegrations.ts` implements all five and `NodeConfigPanel.tsx` already listed them
   as credential-requiring node types). For those five, there was no way to create a
   working credential through the UI at all.
2. **The node config panel's credential picker had no path to create a credential
   inline** — a user had to leave the canvas, go to `/credentials`, create one (assuming
   its type was even supported, per #1), then come back and manually re-select it. Any
   node type with zero existing credentials was permanently stuck at "None".

### What changed

- **`apps/web/src/lib/credentialSchemas.ts`** *(new)* — single source of truth for all 10
  credential types, their exact field names (cross-checked against every worker node's
  `credential?.xyz` reads, e.g. `discord.webhookUrl`, `telegram.botToken`,
  `postgres.connectionString`), display labels/colors, and a `nodeType → credentialType`
  map so the node panel knows exactly which credential type a given node needs.
- **`apps/web/src/components/CredentialQuickCreateModal.tsx`** *(new)* — inline
  "+ New credential…" flow launched directly from a node's credential dropdown, pre-locked
  to the type that node requires, saves via the existing `POST /credentials` API, and
  immediately selects the new credential on the node — no page navigation.
- **`apps/web/src/components/CredentialFieldsForm.tsx`** *(new)* — the labeled-field
  renderer, shared by `CredentialsPage.tsx` and the new modal so they can never drift out
  of sync.
- **`apps/api/src/utils/credentialTest.ts`** — added live "Test connection" checks for
  `discord`, `telegram`, `notion`, `github`, `postgres` (previously only 4 of the 10 types
  had a real check; the rest silently returned "no test defined").
- **`apps/web/src/components/NodeConfigPanel.tsx`** — credential dropdown now shows the
  credential's name + a ✓/⚠ status marker, lists type-matching credentials first, and adds
  a **"🔌 Test connection"** button that calls the test endpoint without leaving the
  canvas and refreshes the picker/canvas status in place.
- **`apps/web/src/lib/nodeTypeMeta.ts`** *(new)* — single source of truth for every node
  type's icon/category/accent color.
- **`apps/web/src/components/NodePalette.tsx`** — rebuilt from a plain text list into a
  categorized, colored icon-tile grid (Make.com-style app picker) sourced from
  `nodeTypeMeta.ts`.
- **`apps/web/src/components/FlowNode.tsx`** — canvas nodes now render the same colored
  icon swatch as the palette, plus a small credential-status dot (amber = required
  credential not attached, green = attached) driven by the same
  `NODE_TYPE_TO_CREDENTIAL_TYPE` map used by the node panel.
- **`apps/web/src/pages/CredentialsPage.tsx`** — refactored onto the shared schema (so it
  now also supports creating the 5 previously-missing credential types), added a colored
  type-icon badge per credential in the list, and colored dots on the OAuth "Connect
  with…" buttons.

### Known gap, called out rather than hidden

Self-service OAuth is still **not** implemented — "Connect with Google/Slack/GitHub"
still requires a server admin to set `GOOGLE_OAUTH_CLIENT_ID` (etc.) in `.env`; there is
no in-app way for a workspace to register its own OAuth app yet. The button correctly
disables itself with an explanatory tooltip when unconfigured rather than silently
failing, but the underlying capability — an org-level OAuth app settings page backed by a
new encrypted-config table — has not been built. Scoped as a follow-up, not done here.

No `node_modules` were installed while making these changes (this sandbox has no network
access), so they were verified by manual trace of every new import/prop/type through the
touched files rather than a live `tsc -b`/`vite build`. Run `pnpm install && pnpm -r
typecheck` before deploying.

## Execution/debugging parity with n8n (Phase 3 — this round)

Goal: live execution view that highlights the active node, animates the running edge,
and lets you inspect each node's input/output JSON as (or after) a run happens, plus
per-node timing/item-count badges — on top of the existing final-state
`ExecutionHistoryPage.tsx`, which is unchanged and still the place to review past runs.

### What changed

- **`apps/worker/src/engine/executor.ts`** — `StatusEmitter` now carries `input`,
  `durationMs`, and `itemCount` alongside the existing `output`/`error`. Every node's
  `running` emit includes its resolved input items and item count; every `success`/
  `failed` emit includes wall-clock duration (`Date.now()` captured at the start of
  `processNode`) and the resulting item count. Pin Data and `continueOnFail` soft-success
  paths are covered too, so a pinned or soft-failed node still gets a badge.
- **`apps/worker/src/pubsub/publisher.ts`** — `StatusMessage` extended with the same
  `input`/`durationMs`/`itemCount` fields (the worker already spreads the emitted event
  into `publishStatus`, so no call-site changes were needed beyond the type).
- **`apps/api/src/realtime/socket.ts`** — the Redis→Socket.IO relay's parsed event type
  extended to match; it already forwards the whole event object, so the new fields reach
  the browser for free.
- **`apps/web/src/components/NodeInspectPopover.tsx`** *(new)* — n8n-style popover with
  Input/Output tabs (Error tab replaces Output on a failed node), duration, item count,
  and status, opened from a node's data badge.
- **`apps/web/src/components/FlowNode.tsx`** — nodes now show a small clickable badge
  under the label once they've run: `⏳ running…` while active, or `NNms · N items` (styled
  red with `· error` on failure) once settled. Clicking it toggles `NodeInspectPopover`
  for that node. `FlowNodeData` gained `lastRunInput/Output/Error/DurationMs/ItemCount`.
  (Also made `nodeType`/`status` optional on `FlowNodeData` to fix a pre-existing type
  error where sticky-note/group canvas nodes — which don't carry those fields — couldn't
  satisfy `Node<FlowNodeData>[]`; `FlowNode` now defaults `status` to `'idle'` and handles
  a missing `nodeType` gracefully instead of relying on the type system to paper over it.)
- **`apps/web/src/pages/CanvasPage.tsx`** — the execution socket handlers now stash
  `input`/`output`/`durationMs`/`itemCount` onto the relevant node's data on
  `node:started`/`node:completed`/`node:failed`, and `execution:started` clears all of
  that state for a fresh run. Edges leaving the currently-active node are set `animated:
  true` with a signal-colored stroke while that node runs, and un-animated again once it
  settles or the run ends — giving the "flow moving along the wire" effect from n8n's
  live view. The existing pin-data badge (📌) on `FlowNode` was already in place from an
  earlier round and is untouched.

### Not done in this pass

Per-node "Pin data" visual indicator and the credential-status dot were already shipped
in earlier phases and are unchanged here. `ExecutionHistoryPage.tsx` (the after-the-fact
history view) was intentionally left alone — Phase 3 only adds the *live* overlay on the
canvas; consolidating the two views is a reasonable future follow-up but wasn't asked for.

### Verified

This round *was* built and typechecked with a live `pnpm install` (network available in
this environment): `packages/shared-types`, `apps/worker`, and `apps/api` all pass
`tsc -p tsconfig.json` (or `tsc -b`) with zero errors, and `apps/web` passes both `tsc -b`
and a production `vite build` (`dist/` output, 636 kB main bundle, no build errors — the
one warning is Vite's standard "chunk >500kB" advisory, not an error). No test files
target the touched modules yet; existing `vitest` suites were left untouched and not
re-run in this pass.

## Schema-driven config sidebar (this round)

Goal: bring the node configuration sidebar closer to Make.com/n8n — a proper form per
node type instead of hand-editing raw params JSON for everything — without touching any
API/worker contract. `workflowsRouter.put()`, `resolveExpressions()`, and every worker
node plugin under `apps/worker/src/nodes/*.ts` are byte-for-byte unchanged; this is a
web-only, additive pass, so existing saved workflows keep loading and running exactly
as before.

### What changed

- **`apps/web/src/lib/paramSchemas.ts`** *(new)* — a per-node-type field registry
  (`webhook, schedule, httpRequest, openai, slack, googleSheets, if, switch, set`)
  describing label/type/default/help/`visibleIf`/`validate` for each param. Field types:
  `string | expression | text | number | boolean | enum | object | array | json`. Node
  types with no entry here fall back to the pre-existing raw-JSON editor untouched.
- **`apps/web/src/components/ParamForm.tsx`** *(new)* — generic renderer for every field
  type above, plus a few guided extras layered on top for the highest-value node types:
  - **webhook** — live "final URL" preview (`/webhook/:workflowId/:path`) with a copy
    button, and a duplicate-path warning against sibling webhook nodes on the same canvas.
  - **schedule** — humanized cron description + next 5 fire times, computed by a new
    dependency-free `apps/web/src/lib/cronUtils.ts` (not used by the real scheduler —
    `apps/api/src/utils/scheduler.ts` still owns actual cron evaluation via BullMQ; this
    is preview-only).
  - **httpRequest** — a "Body content type" preset selector (JSON / form-urlencoded /
    raw text / none) that sets or clears the `Content-Type` header for you.
  - **openai** — a "+ Insert `{{input}}`" button for the prompt field and a live
    character count on the system prompt.
  - Also exports `isScheduleCronValid()`, used by `CanvasPage.tsx` to disable the
    **Activate** button while a Schedule node's cron is invalid (the workflow can still
    be saved as a draft).
- **`apps/web/src/components/NodeConfigPanel.tsx`** — mounts `ParamForm` above the
  existing JSON editor for any node type with a schema, behind a **"Raw JSON" / "Use
  form"** toggle that stays in sync in both directions (editing the form updates the raw
  JSON string mirror; editing raw JSON and blurring re-parses back into the form). The
  `switch` node keeps its existing bespoke `SwitchCasesEditor` untouched — a generic
  array editor would have lost that component's up/down case-priority reordering UX.
  The Test Node panel gained a **Single object / Array of items** input-mode toggle (both
  ultimately send the same `input` field to `POST /nodes/test-run` — the worker's
  `normalizeToItems()` already turns a JSON array into one item per element, so no API
  change was needed) and now persists the last test input + mode per `workflowId:nodeId`
  in `sessionStorage`, plus shows an "Items out" count after a run.
- **`apps/web/src/pages/CanvasPage.tsx`** — passes `workflowId` and the list of sibling
  webhook `params.path` values into the panel (for the URL preview / duplicate warning),
  and gates the Activate button on `isScheduleCronValid()` across all Schedule nodes.

### Not done in this pass

Google Sheets and Slack got schema-driven fields but no bespoke payload builder beyond
that (no per-row mapping UI for Sheets, no rich-text/block builder for Slack) — flagged
as a reasonable next step, not attempted here. Live field-picker suggestions sourced from
an upstream node's last real output (vs. today's static `$node["Label"].json`
autocomplete) were also left for later, as were credentials quick-create shortcuts beyond
what already existed.

### Verified

`apps/web` passes `tsc -b` (project build mode, zero errors) with a live `npm install`
against the real npm registry, and `oxlint` on every touched/added file reports zero
errors (one harmless "fast refresh only works when a file only exports components"
style warning on `ParamForm.tsx`'s exported `isScheduleCronValid` helper — functionally
inert). No existing test files target the touched modules; nothing was re-run or skipped
beyond that.

## Visual & catalog quality pass — Make.com/n8n parity (Phases 1-3 of 4)

Presentation-layer + content pass across the canvas node chrome, the node icon system, and
the template gallery, aimed at closing the biggest visual/catalog gaps vs. Make.com and
n8n. Explicitly out of scope and untouched: `workflowsRouter.put()`,
`resolveExpressions()`, worker node execution logic, and `ParamForm.tsx`/`paramSchemas.ts`
(the config sidebar from the previous pass). All 4 phases are now done.

### Phase 1 — real, recognizable node icons

Every node icon was a plain emoji rendered as `<span>{meta.icon}</span>` — inconsistent
across OS/browser emoji fonts and nowhere near n8n/Make's instantly-recognizable brand
icons.

- **`apps/web/src/lib/nodeTypeMeta.ts`** — added an `iconKey` field per node type
  (`si:siSlack` for a branded service mark, `lucide:GitBranch` for a generic/logic glyph),
  keeping the emoji as a documented fallback so nothing breaks mid-migration or for an
  unmapped community node type.
- **`apps/web/src/components/NodeIcon.tsx`** *(new)* — the single icon-rendering entry
  point for the whole app. Resolves `si:` keys to real brand SVGs from the CC0
  `simple-icons` package (actual brand hex, e.g. Slack `#4A154B`, Discord `#5865F2`), `lucide:`
  keys to `lucide-react` components for logic/generic nodes (IF → `GitBranch`, Switch →
  `Shuffle`, Schedule → `Clock`, Webhook → `Webhook`, For Each → `Repeat`, Code →
  `Braces`, etc.), and only falls back to the emoji when neither resolves. Also exports
  `findBrandIconByName()` for the Marketplace, which matches by npm package name rather
  than node type.
- Wired into all three places an icon rendered: `FlowNode.tsx` (canvas), `NodePalette.tsx`
  (node picker sidebar + Recently Used), and `TemplateGalleryPage.tsx`'s app-icon row — one
  icon system everywhere, not a bespoke one per surface. `MarketplacePage.tsx` also got a
  small icon tile per package using the same system as a down payment on Phase 4.
- `apps/web/package.json` — added `lucide-react` and `simple-icons` (CC0) as dependencies.

### Phase 2 — node card polish + density toggle + resizable cards

- **`apps/web/src/lib/nodeDensity.ts`** *(new)* — `NodeDensityContext`
  (`compact`/`comfortable`/`expanded`) and `CredentialNamesContext` (credential id → name
  lookup for the Expanded tier). Both are plain canvas-UI React contexts, never part of
  `node.data`/params, so they can never leak into `handleSave`'s `nodesPayload` or the
  saved workflow JSON.
- **`apps/web/src/components/FlowNode.tsx`** — three density tiers: **Compact** (~120px,
  icon + type only, tooltip-on-hover label, no run badge, for dense 40-node canvases),
  **Comfortable** (unchanged existing layout), **Expanded** (adds a truncated one-line
  `lastRunOutput` preview and the real credential name instead of just the presence dot).
  Added React Flow's `NodeResizer` (Comfortable/Expanded tiers only, 160–420px), storing
  the width in a new UI-only `data.uiWidth` field that `handleSave` never reads. Added the
  hover-lift/shadow treatment (`shadow-sm hover:shadow-lg hover:-translate-y-px`) matching
  Make.com's card elevation. Status rings, the credential dot, the pinned badge, IF
  true/false handles, and the inspect popover are all unchanged.
- **`apps/web/src/pages/CanvasPage.tsx`** — added the Compact/Comfortable/Expanded toolbar
  toggle (persisted to `localStorage`, not workflow state), a `credentialNames` lookup
  memo built from the credentials list the page already loads, and wrapped `<ReactFlow>` in
  both new context providers.

### Phase 3 — template gallery: 36 templates, richer metadata, filtering

- **`apps/api/src/routes/templates.ts`** — grew from 6 to 36 static templates. All 5
  original categories now have 4+ entries each (`AI`, `Data`, `Dev`, `Notifications`,
  `Scheduling`), plus 8 new categories from the brief: `CRM/Sales`, `DevOps`, `Support`,
  `E-commerce`, `Content`, `Data Ops`, `Agent`, `RAG`. Every template now carries
  `difficulty` (`beginner`/`intermediate`/`advanced`), `estimatedSetupMinutes`, and
  `requiredCredentialTypes` (derived from its node types via a small local
  node-type→credential-label map, kept independent of the web app's
  `credentialSchemas.ts` to avoid an api/web import). The summary payload sent to the
  client also now includes lightweight `nodes`/`edges` (id/type/position,
  source/target/sourceHandle) — just enough data for a client-side graph-preview
  thumbnail, no screenshot/asset pipeline needed. An `order` field (array index) gives the
  gallery's "Newest" sort something real to sort by for static, code-shipped data.
- **`apps/web/src/pages/TemplateGalleryPage.tsx`** — added `TemplateGraphPreview`, an
  inline SVG mini-map rendered from each template's actual node positions/edges (boxes
  colored + icon'd via `<NodeIcon>`/`nodeTypeMeta`, arrows colored green/red for IF
  true/false branches) — the realistic, low-effort equivalent of Make.com's template
  screenshots. Every card now also shows a difficulty badge, an "~N min setup" chip, and a
  "Needs: X, Y" credential-requirement line. Category filtering is now multi-select
  (toggle any combination; "All" clears it) instead of single-select, and there's a new
  sort control (Most used / Newest / Difficulty). Search also matches raw node type
  strings now, not just their display labels. Everything still runs client-side against
  the one `/templates` fetch — no new endpoints were needed.

### Phase 4 — Marketplace advanced browsing, trust signals & install UX

- **`apps/api/src/marketplace/registryIndex.ts`** — grew the curated index from 3 to 15
  entries across the brief's categories (CRM: HubSpot, Salesforce Lite; Support: Zendesk,
  Intercom; Marketing: Mailchimp, ConvertKit; Dev tools: Linear, Jira; Storage: Airtable,
  Dropbox; Payments: Stripe; Productivity: Asana, Trello, ClickUp — plus the original
  Airtable/Zendesk/Mailchimp). Every entry now carries `category`, `verified: true`
  (reserved for this curated file — direct npm-name installs from the "install by name"
  form are never in this array and so are never verified), and a `changelogUrl`. Added
  `withDownloadCounts()`, which fetches real monthly downloads from
  `https://api.npmjs.org/downloads/point/last-month/<pkg>` (same registry host already used
  for install — no new external dependency) with a 1-hour in-memory cache, and returns
  `null` — never a fabricated number — on any lookup failure (expected for the
  scaffolded/placeholder package names above, since they aren't real published packages).
  `listCategories()` derives the filter-chip list from the index itself, so adding a
  category to an entry is enough to make it filterable.
- **`apps/api/src/routes/marketplace.ts`** *(additive only — the real npm-install/tarball
  code path is untouched)* — `GET /marketplace` now accepts `&category=` alongside the
  existing `?query=` and attaches `downloadsLastMonth` to every entry via
  `withDownloadCounts()`. Added `GET /marketplace/categories` and
  `GET /marketplace/:name/versions` (proxies npm's full version list with publish dates,
  for a real version picker instead of just "latest").
- **`apps/web/src/pages/MarketplacePage.tsx`** — category filter chips reuse the exact
  pill pattern from `TemplateGalleryPage.tsx` (`role="group"`, `aria-pressed`, same
  `rounded-full` classes) rather than inventing a fourth chip style, and compose with the
  existing debounced search (both narrow the same list together). Each curated card now
  shows a verified badge (`BadgeCheck` + "verified · official") vs. a plain "community"
  label for anything not in the curated file, a category chip, and a
  `downloadsLastMonth` count formatted as `1.2k`/`3.4M`/`—`. The version input becomes a
  real `<select>` of published versions (lazy-loaded on focus from the new
  `/versions` endpoint) when they're available, falling back to the old free-text pin
  field if the lookup comes back empty. Install/update/direct-install all now run through
  `runInstall()`, which drives a `Resolving → Downloading → Extracting → Registering
  nodes` dot-sequence on a fixed cadence for the duration of the real
  `POST /marketplace/install` request — the last stage is only shown once that request has
  actually resolved, and the progress indicator is explicitly titled "Approximate
  progress — not a live server event stream" since this is a single request/response, not
  SSE/polling (flagged as the larger, out-of-scope alternative in the brief). Errors from
  a failed install now include a short cause line (network-unreachable / 404 package not
  found / 5xx server error) appended to the server's own message instead of one generic
  string. The "Installed" section auto-checks every installed package for updates once on
  load (reusing `GET /marketplace/latest/:name`) instead of requiring a manual click per
  package, and its empty state now reads "Nothing installed yet — browse the catalog
  below" instead of rendering nothing.
- **`packages/shared-types/src/index.ts`** — `CommunityNodeManifest` gained the four new
  optional fields (`category`, `verified`, `downloadsLastMonth`, `changelogUrl`) shared
  between the API and web app.
- Untouched, as required: `workflowsRouter.put()`, `resolveExpressions()`, worker node
  execution logic, `ParamForm.tsx`/`paramSchemas.ts`, and the real npm-install/tarball
  download/extract/DB-record/Redis-notify code path in `routes/marketplace.ts` — Phase 4
  only added a `category` query param, two new read-only `GET` endpoints, and new fields
  on existing response shapes.

### Verified

Manual read-through and structural checks (brace/tag balance, category-list cross-
reference between the new registry entries and the client's chip renderer, route-path
collision check across all `marketplaceRouter` handlers) on every touched/added file, plus
the same checks from Phases 1-3 (node-type cross-reference, template id/category counts).
`lucide-react` and `simple-icons` were added to `apps/web/package.json` in Phase 1 but
this sandbox has no reliable network access to run `npm install` end-to-end, so none of
Phases 1-4 have been through a live `tsc -b`/`vite build` — run `npm install` at the repo
root (or inside `apps/api` and `apps/web`) and a full build/typecheck before deploying.

## Design system upgrade & n8n/Make.com feature parity (Phase 5 depth pass)

Two work-streams: componentizing the accumulated duplicate UI patterns into a small
shared component set, and closing specific, re-verified n8n/Make.com parity gaps.

### Audit correction — read this before trusting the brief's gap list

The Phase 5 brief's "verified-missing" list was itself stale in two important ways,
caught by re-checking the code before building rather than trusting the brief:

- **Workflow-level sharing/permissions was already fully built** — `WorkflowShare` DB
  functions, `/workflows/:id/shares` routes with role-gated middleware, ownership
  transfer, and a complete `WorkflowShareModal` UI already wired into `CanvasPage.tsx`'s
  toolbar (see "Workflow-level sharing & ownership transfer" above). This was **not**
  rebuilt — doing so would have been a straight regression, exactly the failure mode the
  brief itself warned about.
- **Workflow tags' backend was already fully built** — `Tag`/`WorkflowTag` tables (added
  back in the migration covered under "Variables, tags, error workflows, and manual test
  payloads" above), full CRUD in `apps/api/src/routes/tags.ts`
  (`GET/POST /tags`, `DELETE /tags/:id`, `GET/PUT /tags/workflows/:workflowId`), and
  `GET /workflows?tag=` filtering already wired into `workflowsRouter`. The only real gap
  was the **frontend** — no tag chips/filter/editor existed on `WorkflowsListPage.tsx`.
  That's the only tags work this phase actually did.
- **`NodePalette`'s category headers were miscategorized as a fourth duplicate pill
  implementation.** They're static section labels (a small colored dot + uppercase text,
  no `rounded-full`, no click handler, no active/inactive state) — not an interactive
  filter pill at all. Left alone rather than force a migration that would have changed
  working, non-duplicate UI under a false premise.
- Per-node notes (2a) *was* genuinely missing everywhere (web/api/worker) — that's real,
  new work, detailed below.

### Work-stream 1 — shared UI primitives (`apps/web/src/components/ui/`)

- **`FilterPillGroup.tsx`** — single- or multi-select pill/chip group. Renders
  `role="radiogroup"` (single-select) or `role="group"` with `aria-checked` per pill
  (multi-select), left/right arrow-key roving navigation between pills, and the existing
  `focus-ring` treatment. Replaces the near-identical `rounded-full` filter
  implementations in `TemplateGalleryPage.tsx` (multi-select category filter) and
  `MarketplacePage.tsx` (single-select category filter) — both migrated, zero behavior
  change to the underlying filtering logic. Also used for the new tag filter on
  `WorkflowsListPage.tsx`.
- **`SegmentedToggle.tsx`** — connected segmented control for an exclusive ternary
  choice, purpose-built for (and now used by) `CanvasPage.tsx`'s Compact/Comfortable/
  Expanded density toggle, which is a single setting rather than independent filters and
  so intentionally isn't a `FilterPillGroup`.
- **`Badge.tsx`** — small uppercase status/meta chip with `neutral`/`signal`/`alert`/
  `amber` variants, replacing the repeated inline
  `text-[10px] uppercase tracking-wide ... rounded px-1.5 py-0.5` pattern. In use on
  `TemplateGalleryPage.tsx` (category + setup-time chips), `MarketplacePage.tsx`
  (installed package version/source/update-available chips), `CredentialsPage.tsx`
  (credential type/OAuth2/shared-access chips), and `WorkflowsListPage.tsx` (tag chips).
  Left `TemplateGalleryPage.tsx`'s per-difficulty `DifficultyBadge` alone — it uses a
  dynamic per-difficulty color, not one of the four fixed Badge variants, so folding it
  into `Badge` would have meant losing the color coding.
- **`Card.tsx`** — the bordered list-item shell (`bg-panel` + border + `rounded-lg`
  padding), with an optional `hoverLift` prop reusing the same
  `shadow-sm hover:shadow-lg hover:-translate-y-px`-style treatment already established
  on canvas nodes in Phase 2, via the new `.elevation-card` CSS class (see below) so cards
  and canvas nodes read as one visual language. In use on `MarketplacePage.tsx`
  (installed package list), `CredentialsPage.tsx` (credential list), and
  `WorkflowsListPage.tsx` (workflow list).
- **`Button.tsx`** — `primary`/`secondary`/`ghost` variants with a built-in `loading`
  prop (spinner + auto-disable), replacing the repeated hand-rolled
  `disabled={busy} ... {busy ? 'Working…' : 'Do it'}` pattern. In use on
  `TemplateGalleryPage.tsx` ("Use this template"), `MarketplacePage.tsx` (update/check-
  for-updates/uninstall), `CredentialsPage.tsx` (test connection), and
  `WorkflowsListPage.tsx` (new workflow, add tag).
- **`index.css`** — added a `.transition-default` utility (150ms,
  `cubic-bezier(0.4, 0, 0.2, 1)`) so hover/focus transitions share one duration/easing
  instead of the previous ad hoc bare `transition` (browser-default ~0ms on some
  elements). Added a 3-level elevation system — `.elevation-panel` / `.elevation-card` /
  `.elevation-floating` — as shared `border` + `box-shadow` combinations, with a
  `[data-theme='white']` override so shadow contrast reads correctly on the light theme
  instead of the near-invisible smear a dark-theme shadow value produces on a white
  background.

### Work-stream 2 — n8n/Make.com feature-parity gaps

**2a. Per-node notes** (genuinely missing, now shipped end-to-end):

- `apps/api/src/routes/workflows.ts` — added `notes: z.string().nullable().optional()`
  to `nodeSchema`, following the exact same "display-only metadata, never read by
  execution" pattern already used for `style`/`parentId` on sticky-note/group nodes.
  `workflowsRouter.put()`'s handler body, `resolveExpressions()`, and the worker's
  executor were **not** touched — `notes` round-trips through `nodesJson` (a JSONB
  column, no migration needed) purely as data the worker never looks at.
- `apps/web/src/pages/CanvasPage.tsx` — `notes` added to the load mapping (workflow JSON
  → React Flow node data) and to `handleSave`'s `nodesPayload` builder, so — unlike
  `uiWidth`, which is deliberately *excluded* from `nodesPayload` and never persists —
  notes genuinely survive save/reload, per the brief's acceptance criterion.
- `apps/web/src/components/FlowNode.tsx` — a 🗒️ affordance next to the pin badge,
  Comfortable/Expanded density tiers only (Compact stays uncluttered per the brief), that
  toggles a new `NodeNotePopover.tsx` — a small read-only popover mirroring
  `NodeInspectPopover.tsx`'s absolute-positioned card styling rather than overloading that
  component's unrelated run-snapshot props.
- `apps/web/src/components/NodeConfigPanel.tsx` — a plain `<textarea>` Note field, right
  under the Label field and visually separated from the node's functional parameters,
  with the same blur-commit pattern as Label.

**2b. Workflow tags** (backend pre-existing, frontend added):

- `apps/web/src/pages/WorkflowsListPage.tsx` — rewritten to add: a `FilterPillGroup`
  single-select tag filter bar (refetches `GET /workflows?tag=` on selection); tag chips
  on each workflow card (`GET /tags/workflows/:id`, loaded per-visible-workflow since
  there's no batch endpoint); and an inline "+ Edit tags" panel per card that toggles tag
  membership via `PUT /tags/workflows/:id` and can create a new tag via `POST /tags`.

**2c. Workflow sharing/permissions:** confirmed already fully shipped (see the audit
correction above) — nothing to build.

### Not done in this pass

- `ExecutionHistoryPage.tsx` was not migrated to the new `Badge`/`Card` primitives —
  called out in the brief as one of the four target pages but not reached.
- The full 1c visual-polish sweep (spacing-rhythm audit across `p-5`/`px-4 py-3`/`p-4`,
  `EmptyState` usage audit across every list page, responsive check of Marketplace/
  Template Gallery/Canvas toolbar at sub-640px widths, `simple-icons` per-icon subpath
  imports, `React.memo` on `TemplateGraphPreview`, and the IF-edge colorblind shape
  differentiation from the Phase 4 handoff) was not attempted — the elevation/motion
  tokens and the primitives themselves are in place, but applying them everywhere and
  doing the responsive/audit work is a large enough surface to warrant its own pass
  rather than a rushed sweep.
- Two pill/chip spots the brief's list technically also matched but that weren't
  interactive filter pills at all (`NodePalette`'s category headers, per the audit
  correction above) were deliberately left as-is.

### Verified

Manual read-through of every touched file, plus a brace/paren balance check (via a
small Node script) on all new/edited `.tsx`/`.ts` files in this pass to catch edit
mistakes — one pre-existing imbalance was found in `NodeConfigPanel.tsx` (a
`{'{{'}` JSX text literal on its "type `{{` for expression autocomplete" hint, present
before this phase) and confirmed harmless, not introduced by this pass's edits. Same
`npm install`/`tsc -b`/`vite build` limitation as every prior phase — this sandbox has no
reliable network access to install dependencies, so none of this has been through a live
typecheck or build; run one before deploying.
