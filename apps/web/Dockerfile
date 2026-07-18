FROM node:20-slim AS build
RUN npm install -g pnpm@9
WORKDIR /repo

COPY package.json pnpm-workspace.yaml .npmrc ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json

RUN pnpm install --no-frozen-lockfile

COPY packages/shared-types packages/shared-types
COPY apps/web apps/web

RUN pnpm --filter @flowforge/shared-types build
RUN pnpm --filter @flowforge/web build

FROM node:20-slim
RUN npm install -g serve
COPY --from=build /repo/apps/web/dist /app/dist
EXPOSE 5173
CMD ["serve", "-s", "/app/dist", "-l", "5173"]
