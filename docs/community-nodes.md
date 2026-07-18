# Community Nodes & Marketplace

FlowForge nodes don't all have to live in this repo. A community node is a
small npm package that registers one or more `NodePlugin`s; installing one
through the marketplace API drops it into a shared directory the worker
scans on boot (and hot-reloads on install/uninstall, no restart needed).

## For workflow builders

- `GET /marketplace?query=airtable` — browse the curated index
- `POST /marketplace/install { "npmPackage": "flowforge-node-airtable" }` — install
- `GET /marketplace/installed` — see what's installed on this instance
- `DELETE /marketplace/:name` — uninstall

Installed nodes show up in the palette under type
`community.<packageName>.<nodeType>`, namespaced so they can never collide
with (or override) a built-in node.

## For node authors

Publish a normal npm package with a `flowforge` field in `package.json`:

```json
{
  "name": "flowforge-node-airtable",
  "version": "1.0.0",
  "main": "dist/index.js",
  "flowforge": {
    "nodeTypes": ["airtable"],
    "description": "Read/write Airtable bases",
    "homepage": "https://github.com/you/flowforge-node-airtable"
  }
}
```

`dist/index.js` (compiled CommonJS) default-exports:

```js
module.exports = {
  manifest: { name: 'flowforge-node-airtable', version: '1.0.0', nodeTypes: ['airtable'], description: '...' },
  nodes: [
    {
      type: 'airtable',
      async execute({ params, credential }) {
        // same NodeExecutionContext every built-in node gets
        return { output: { ok: true } };
      },
    },
  ],
};
```

Submit a PR adding your package to
`apps/api/src/marketplace/registryIndex.ts` to appear in marketplace search
— installing still works via `npmPackage` even if you skip this, as long as
the person doing the install knows your package name.

## Security note

Installing a community node runs its code inside the worker process — the
same trust boundary as any npm dependency. `POST /marketplace/install`
currently requires only a logged-in user; before exposing this beyond
trusted operators, gate it behind an admin role check.

## Deployment note

`COMMUNITY_NODES_DIR` (default `/data/flowforge-community-nodes`) must be a
shared volume mounted into both the `api` container (which writes installs)
and every `worker` container (which reads them) — see `docker-compose.yml`.
