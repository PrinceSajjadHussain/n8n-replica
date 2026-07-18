# Running FlowForge locally (npm)

This repo is an **npm workspaces** monorepo (previously pnpm — that's been converted).
Do not run `npm i -f`; just `npm install` from the repo root.

## 1. Prerequisites
- Node.js 20+ and npm 10+ (check with `node -v` / `npm -v`)
- Docker Desktop (for Postgres + Redis) — or your own local Postgres/Redis

## 2. Install dependencies (root only — installs every workspace)
```bash
cd flowforge
npm install
```
Do this from the **repo root**, not from `apps/api` or `apps/web` individually —
npm workspaces need the root install to link `@flowforge/shared-types` and
`@flowforge/node-sdk` into the apps that depend on them.

## 3. Environment variables
```bash
cp .env.example .env
```
The defaults point at the ports docker-compose.yml exposes (Postgres on 5433,
Redis on 6380) so they don't collide with anything already running locally.

## 4. Start Postgres + Redis
Easiest — via Docker:
```bash
docker compose up -d postgres redis
```
Or point `DATABASE_URL` / `REDIS_URL` in `.env` at your own instances.

## 5. Apply the database schema
```bash
cd apps/api
npx prisma migrate deploy
cd ../..
```
(Or apply the raw SQL files in `apps/api/prisma/migrations/*/migration.sql` in order.)

## 6. Build the shared packages once
```bash
npm run build:shared-types
npm run build:node-sdk
```

## 7. Run everything (3 separate terminals, from repo root)
```bash
npm run dev:api      # http://localhost:4000
npm run dev:worker
npm run dev:web      # http://localhost:5173
```

## 8. (Optional) Browser-automation sidecar
Only needed for the `browserAutomation` node:
```bash
cd services/browser-runner
npm install
npm start
```

## What changed from the original pnpm setup
- Root `package.json` now has a `"workspaces": ["apps/*", "packages/*"]` field
  instead of `pnpm-workspace.yaml` (removed).
- Every internal `"workspace:*"` dependency (e.g. `@flowforge/shared-types`,
  `@flowforge/node-sdk`) was changed to `"*"`, which is what npm workspaces
  expects for symlinking local packages.
- Root scripts (`dev:api`, `dev:worker`, `dev:web`, `build`, `lint`) now use
  `npm run <script> --workspace=<name>` / `--workspaces` instead of pnpm's
  `--filter`.
- `pnpm-lock.yaml` was removed; a fresh `package-lock.json` will be generated
  the first time you run `npm install`.
- Fixed several TypeScript errors uncovered by a full `tsc --noEmit` pass
  across every package (API, worker, web, and the two shared packages) —
  see the "Syntax/type fixes" section below.

## Syntax/type fixes made
- `apps/api/src/routes/workflowVersions.ts` — the rollback route called the
  unsupported `router.handle()` method; publish logic was extracted into a
  shared `publishVersion()` function used by both the publish and rollback
  routes instead.
- `apps/api/src/utils/emailPoller.ts` — added `@types/mailparser` and typed
  an implicit-`any` callback parameter.
- `apps/api/src/utils/saml.ts` — `@node-saml/node-saml`'s config field is
  `cert`, not `idpCert`; also fixed a `Record<string, unknown>` fallback typing.
- `apps/api/src/utils/triggerPollers.ts` — cast the Kafka `sasl` option to
  `SASLOptions` (kafkajs's discriminated union couldn't be inferred from our
  looser config shape), and reordered `xreadgroup`'s `COUNT`/`BLOCK` args to
  match ioredis's typed overload.
- `apps/worker/src/engine/executor.ts` — narrowed `subgraph` to non-undefined
  after its guard clause, and corrected a `Map<string, unknown>` that should
  have been `Map<string, NodeItems>` when restoring a paused execution's
  checkpoint.
- `apps/worker/src/engine/expressions.ts` — `random.int(min, max)` helper
  wasn't accepting the `args` it was called with; gave it an optional
  `args` parameter and real range support.
- `apps/worker/src/index.ts` / `apps/worker/src/db/executions.ts` — widened
  the trigger-type union to include `emailTrigger` / `fileWatcher` /
  `databaseChange` / `streamTrigger`, matching what `@flowforge/shared-types`
  already declared.
- `apps/worker/src/nodes/agentNode.ts` — cast two `unknown` stage outputs
  before spreading them into the reasoning trace.
- `apps/worker/src/nodes/ragNode.ts` — `resolveDocuments`'s `items` param
  now uses the shared `NodeItems` type instead of a stricter local shape
  that didn't match real node item data (where `binary.data` can be
  undefined).

All packages (`apps/api`, `apps/worker`, `apps/web`,
`packages/shared-types`, `packages/node-sdk`, `packages/node-cli`) now pass
`tsc --noEmit` cleanly, and `apps/web` builds successfully with `vite build`.
