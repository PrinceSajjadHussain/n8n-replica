import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

/** `flowforge-node create <name>` — scaffolds a minimal, ready-to-edit
 *  custom node package: package.json (with a `flowforge` manifest block the
 *  hot-reload loader reads), a starter node definition, and a test file
 *  using the SDK's test harness. */
export async function createNode(args: string[]) {
  const name = args[0];
  if (!name) throw new Error('Usage: flowforge-node create <node-name>');

  const dir = path.resolve(process.cwd(), name);
  await mkdir(path.join(dir, 'src'), { recursive: true });

  const pkgName = `flowforge-node-${slug(name)}`;
  const nodeType = `community.${slug(name)}.${slug(name)}`;
  const displayName = titleCase(name);

  const packageJson = {
    name: pkgName,
    version: '0.1.0',
    description: `FlowForge custom node: ${displayName}`,
    main: 'src/index.ts',
    scripts: {
      test: 'tsx src/index.test.ts',
      docs: 'flowforge-node docs src/index.ts',
    },
    dependencies: {
      '@flowforge/node-sdk': '*',
    },
    flowforge: {
      displayName,
      description: `FlowForge custom node: ${displayName}`,
      entry: 'src/index.ts',
    },
  };

  const indexTs = `import { defineNode } from '@flowforge/node-sdk';

export default defineNode({
  type: '${nodeType}',
  displayName: '${displayName}',
  description: 'TODO: describe what this node does',
  category: 'Action',
  icon: '⚙️',
  version: '0.1.0',
  fields: [
    {
      key: 'exampleInput',
      label: 'Example input',
      type: 'string',
      required: true,
      description: 'TODO: describe this field',
    },
  ],
  async execute(ctx) {
    ctx.logger.info('Running ${displayName}', { params: ctx.params });

    // TODO: implement the node's behavior. Return one NodeItem per output item.
    return ctx.items.map((item) => ({
      json: { ...item.json, exampleInput: ctx.params.exampleInput },
    }));
  },
});
`;

  const testTs = `import { testNode } from '@flowforge/node-sdk';
import node from './index';

async function main() {
  const output = await testNode(node, {
    params: { exampleInput: 'hello world' },
    items: [{ json: {} }],
  });
  console.log(JSON.stringify(output, null, 2));
}

main();
`;

  const readme = `# ${displayName}

A FlowForge custom node scaffolded with \`flowforge-node create\`.

## Develop

\`\`\`bash
npm install
npm test          # runs src/index.test.ts against sample input
npm run docs       # regenerates docs from the field definitions
\`\`\`

## Install into FlowForge

Copy (or symlink) this directory into the worker's custom-nodes directory
(\`$FLOWFORGE_CUSTOM_NODES_DIR\`, default \`./custom-nodes\`) — the worker
hot-reloads on file changes, so no restart is needed while iterating.
`;

  await writeFile(path.join(dir, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n');
  await writeFile(path.join(dir, 'src', 'index.ts'), indexTs);
  await writeFile(path.join(dir, 'src', 'index.test.ts'), testTs);
  await writeFile(path.join(dir, 'README.md'), readme);

  console.log(`Created custom node package at ./${name}`);
  console.log(`  type: ${nodeType}`);
  console.log(`Next: cd ${name} && npm install && npm test`);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function titleCase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
