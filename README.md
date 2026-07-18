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
- **Monorepo**: pnpm workspaces (`apps/api`, `apps/worker`, `apps/web`,
  `packages/shared-types`, `services/browser-runner`)

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
`waitForWebhook`, `humanApproval`, `subWorkflow`

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
POST   /marketplace/install          { "npmPackage": "flowforge-node-airtable" }
GET    /marketplace/installed        what's actually installed on this instance
DELETE /marketplace/:name            uninstall
```

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

## Triggers beyond webhook/schedule

`apps/api/src/utils/` holds the poller/consumer processes that seed these trigger nodes'
`input` and enqueue an execution job — the trigger node itself is a no-op at execution
time, consistent with how `webhook`/`schedule` already worked:

- `emailPoller.ts` — real IMAP (`imapflow` + `mailparser`), IDLE push where supported
- `triggerPollers.ts` — Postgres `LISTEN`/`NOTIFY` (`databaseChange`), `fs.watch`
  (`fileWatcher`), and three interchangeable `streamTrigger` backends: Redis Streams
  (consumer groups), Kafka (`kafkajs`), and RabbitMQ (`amqplib`, manual ack with requeue)

None of these are wired to a management UI yet — call the `register*Trigger` functions
directly (e.g. from a workflow-activation hook) with the connection config for now.

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
for m in apps/api/prisma/migrations/*/migration.sql; do psql "$DATABASE_URL" -f "$m"; done
```

(If you have internet access and prefer Prisma-managed migrations:
`cd apps/api && npx prisma migrate deploy`.)

### 4. Open the app

Visit `http://localhost:5173`, sign up, and start building.

## Running locally without Docker

```bash
pnpm install
# start postgres + redis yourself, then:
pnpm --filter @flowforge/api dev
pnpm --filter @flowforge/worker dev
pnpm --filter @flowforge/web dev
```

## Building a workflow

1. Open a workflow, drag nodes in from the left palette (built-in nodes plus anything
   installed from the marketplace).
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
pause/resume), auth + credential encryption, webhook/schedule triggers, workflow
versioning (draft/publish/rollback/diff), the node plugin system, the community node
marketplace (real npm install/uninstall + hot reload), and RAG (real loaders, smart
chunking, pluggable vector DBs, hybrid search + reranking — see "Production-grade RAG"
above and `docs/rag.md`).

**Real but intentionally light:** the new email/DB/file/stream triggers (functional
pollers, no management UI yet), the AI agent layer (real tool use + short/long-term
memory + multi-agent orchestration + reasoning-trace UI — see "AI agents" above and
`docs/ai-agents.md` — memory/vector-recall storage is still the JSON-on-disk store, not
yet switched over to the pluggable vector-store layer RAG now uses).

**Not started:** SSO/LDAP/SAML/RBAC/audit logs/rate limiting, a custom-node SDK CLI +
hot-reload dev workflow (the marketplace covers *installing* community nodes; there's no
scaffolding tool for *authoring* one yet), import from n8n/Make/Zapier, export to
LangGraph/CrewAI/Docker/Python, and UI polish (sticky notes, node grouping, auto-layout,
mini-map, command palette, template gallery).

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

*(Note: the integration/agent/versioning/marketplace additions above were built and
reviewed for correctness against their respective SDKs/APIs, but have not been re-run
through the live end-to-end test suite described in this section — do that before
deploying any of it to production.)*
