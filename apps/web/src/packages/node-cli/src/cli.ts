import { createNode } from './commands/create';
import { runDocs } from './commands/docs';
import { runTest } from './commands/test';

const [, , command, ...rest] = process.argv;

async function main() {
  switch (command) {
    case 'create':
      await createNode(rest);
      break;
    case 'docs':
      await runDocs(rest);
      break;
    case 'test':
      await runTest(rest);
      break;
    default:
      printUsage();
      process.exit(command ? 1 : 0);
  }
}

function printUsage() {
  console.log(`FlowForge custom node CLI

Usage:
  flowforge-node create <node-name>   Scaffold a new custom node package
  flowforge-node docs <entry-file>    Generate markdown docs from a node's field definitions
  flowforge-node test <entry-file>    Run a node's execute() against sample input

Examples:
  flowforge-node create my-crm-lookup
  flowforge-node docs ./src/index.ts
  flowforge-node test ./src/index.ts --params '{"query":"hello"}'
`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
