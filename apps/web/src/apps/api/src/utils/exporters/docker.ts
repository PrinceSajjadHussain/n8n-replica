import type { WorkflowGraph } from '@flowforge/shared-types';

/** Emits a self-contained Docker bundle (Dockerfile + docker-compose.yml +
 *  the workflow JSON + a tiny Node runner) that replays a FlowForge workflow
 *  outside the platform, against the same node-type contract the worker
 *  uses. Intended as a portable "export and self-host" path, not a full
 *  copy of the worker's execution engine. */
export function exportToDocker(graph: WorkflowGraph, workflowName: string): Record<string, string> {
  const workflowJson = JSON.stringify({ name: workflowName, ...graph }, null, 2);

  const runner = `#!/usr/bin/env node
// Minimal standalone runner for a FlowForge workflow export.
// Executes nodes in topological order; each node type must be implemented
// in ./nodeHandlers.js — stubs are generated for every node type used below.
const fs = require('fs');
const path = require('path');
const handlers = require('./nodeHandlers');

const graph = JSON.parse(fs.readFileSync(path.join(__dirname, 'workflow.json'), 'utf8'));

function topoOrder(nodes, edges) {
  const inDegree = new Map(nodes.map((n) => [n.id, 0]));
  const adj = new Map();
  for (const e of edges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source).push(e.target);
  }
  const queue = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order = [];
  const seen = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
      if ((inDegree.get(next) ?? 0) <= 0) queue.push(next);
    }
  }
  return order;
}

async function main() {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const order = topoOrder(graph.nodes, graph.edges);
  let context = { items: [{ json: {} }] };
  for (const id of order) {
    const node = byId.get(id);
    const handler = handlers[node.type] ?? handlers.default;
    console.log(\`[flowforge-export] running node \${node.id} (\${node.type})\`);
    context = await handler(node, context);
  }
  console.log('[flowforge-export] done', JSON.stringify(context, null, 2));
}

main().catch((err) => {
  console.error('[flowforge-export] failed', err);
  process.exit(1);
});
`;

  const nodeTypes = Array.from(new Set(graph.nodes.map((n) => n.type)));
  const handlerStubs = nodeTypes
    .map(
      (type) => `  ${JSON.stringify(type)}: async (node, context) => {
    // TODO: implement '${type}' — original params: ${JSON.stringify(
        graph.nodes.find((n) => n.type === type)?.params ?? {}
      )}
    return context;
  },`
    )
    .join('\n');

  const nodeHandlers = `// Auto-generated stubs — one per node type used in "${workflowName}".
// Replace each body with real logic (HTTP calls, transforms, etc).
module.exports = {
${handlerStubs}
  default: async (node, context) => {
    console.warn(\`No handler implemented for node type "\${node.type}"\`);
    return context;
  },
};
`;

  const dockerfile = `FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev || true
COPY . .
CMD ["node", "run.js"]
`;

  const compose = `services:
  ${slug(workflowName)}:
    build: .
    container_name: flowforge-export-${slug(workflowName)}
    restart: "no"
    environment:
      - NODE_ENV=production
`;

  const packageJson = JSON.stringify(
    {
      name: `flowforge-export-${slug(workflowName)}`,
      version: '1.0.0',
      private: true,
      main: 'run.js',
      scripts: { start: 'node run.js' },
    },
    null,
    2
  );

  const readme = `# ${workflowName} — FlowForge Docker export

This bundle replays the workflow's node graph outside FlowForge.

## Files
- \`workflow.json\` — the exported node/edge graph
- \`nodeHandlers.js\` — one stub function per node type; **fill these in**
- \`run.js\` — topologically walks the graph and calls each handler
- \`Dockerfile\` / \`docker-compose.yml\` — containerized run

## Usage
\`\`\`bash
docker compose up --build
\`\`\`
`;

  return {
    'Dockerfile': dockerfile,
    'docker-compose.yml': compose,
    'package.json': packageJson,
    'run.js': runner,
    'nodeHandlers.js': nodeHandlers,
    'workflow.json': workflowJson,
    'README.md': readme,
  };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workflow';
}
