FROM node:20-slim AS base
# isolated-vm needs a native build toolchain
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@9
WORKDIR /repo

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json

RUN pnpm install --frozen-lockfile

COPY packages/shared-types packages/shared-types
COPY apps/worker apps/worker

RUN pnpm --filter @flowforge/shared-types build
RUN pnpm --filter @flowforge/worker build

WORKDIR /repo/apps/worker
CMD ["node", "dist/index.js"]
