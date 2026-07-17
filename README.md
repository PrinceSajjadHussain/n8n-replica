# FlowForge

A full-stack workflow automation platform (n8n / Zapier / Make.com style) — drag-and-drop
canvas, real-time execution visualization, webhook + schedule triggers, and a pluggable
node system.

## Stack

- **Backend**: Node.js 20+, TypeScript, Express, PostgreSQL, Redis, BullMQ, Socket.IO, JWT auth, AES-256-GCM credential encryption, `isolated-vm` sandboxed Code node
- **Frontend**: React 19, Vite, `@xyflow/react` (React Flow), Zustand, TanStack Query, Tailwind CSS, Socket.IO client
- **Monorepo**: pnpm workspaces (`apps/api`, `apps/worker`, `apps/web`, `packages/shared-types`)

## Architecture

```
apps/api     -> REST API: auth, CRUD, enqueues execution jobs. Does NOT run workflow logic.
apps/worker  -> Separate process: pulls jobs from BullMQ, runs the execution engine,
                publishes real-time status via Redis pub/sub.
apps/web     -> React canvas + real-time execution viewer + credentials manager.
packages/shared-types -> Shared TypeScript types (WorkflowGraph, node/edge shapes, events).
```

The execution engine (`apps/worker/src/engine/executor.ts`) topologically sorts the
workflow graph, executes each node via its registered plugin, feeds outputs downstream,
follows only the matching branch of IF nodes (others are marked `skipped`), and isolates
per-node failures so one bad node never crashes the worker process or unrelated branches.

## Node plugin system

Every node type implements:

```ts
interface NodePlugin {
  type: string;
  execute(ctx: { input, params, credential }): Promise<{ output, branch? }>;
}
```

See `apps/worker/src/nodes/types.ts` for the full interface doc + a copy-paste template.
Implemented node types: `webhook`, `schedule`, `httpRequest`, `if`, `merge`, `set`, `code`
(sandboxed via `isolated-vm`), `slack` (real Incoming Webhook POST). Stubbed with a clear
extension pattern: `email`, `googleSheets` (see `apps/worker/src/nodes/stubNodes.ts`).

## A note on the data layer

`prisma/schema.prisma` is the canonical schema (models, indexes, cascading deletes) and
`prisma/migrations/00000000000000_init/migration.sql` is the matching SQL migration.
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
```

### 2. Run everything with Docker Compose

```bash
docker compose up --build
```

This boots Postgres, Redis, the API (`:4000`), the worker, and the web app (`:5173`).

### 3. Apply the database schema

The first time, apply the migration to the fresh Postgres container:

```bash
psql "$DATABASE_URL" -f apps/api/prisma/migrations/00000000000000_init/migration.sql
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

1. Open a workflow, drag nodes in from the left palette.
2. Click a node to configure its `params` (JSON) and, for integrations, pick a saved
   credential from **Credentials**.
3. Connect nodes by dragging from the right handle to the next node's left handle. IF
   nodes have two output handles (top = `true`, bottom = `false`) — connect each to a
   different downstream path.
4. **Save**, then **Run** to trigger manually, or **Activate** to enable its Webhook
   (`POST /webhook/:workflowId/:path`) or Schedule (cron) trigger.
5. Watch node status update live on the canvas as the execution runs, then check
   **History** for full per-node input/output JSON.

## Extending with a new node type

1. Copy the template in `apps/worker/src/nodes/types.ts`.
2. Implement `execute()`, call `registerNode(...)`.
3. Import your new file once from `apps/worker/src/nodes/index.ts`.
4. Add it to the palette list in `apps/web/src/components/NodePalette.tsx`.

No changes to the execution engine are required.

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
