import type { WorkflowGraph, WorkflowNode, WorkflowEdge, NodeType } from '@flowforge/shared-types';

interface MakeModule {
  id: number;
  module: string; // e.g. "http:ActionSendData"
  metadata?: { designer?: { x: number; y: number } };
  mapper?: Record<string, unknown>;
}

interface MakeFlowEntry {
  id: number;
  module?: string;
  routes?: { flow: MakeFlowEntry[] }[];
  [key: string]: unknown;
}

interface MakeBlueprint {
  name?: string;
  flow: MakeFlowEntry[];
}

const MODULE_MAP: Record<string, NodeType> = {
  'gateway:CustomWebHook': 'webhook',
  'builtin:BasicScheduler': 'schedule',
  'http:ActionSendData': 'httpRequest',
  'builtin:BasicRouter': 'switch',
  'builtin:BasicFeeder': 'forEach',
  'email:ActionSendEmail': 'email',
  'slack:CreateMessage': 'slack',
  'google-sheets:addRow': 'googleSheets',
  'openai-gpt-3:CreateCompletion': 'openai',
  'builtin:Sleep': 'wait',
  'discord:CreateMessage': 'discord',
  'telegram:SendMessage': 'telegram',
  'notion:CreatePage': 'notion',
  'github:createIssue': 'github',
  'postgresql:InsertRow': 'postgres',
};

/** Converts a Make.com scenario blueprint (exported as JSON from the scenario
 *  editor) into a FlowForge WorkflowGraph. Make's "flow" is a tree (router
 *  modules nest their branches under `routes[].flow`), which we flatten into
 *  FlowForge's flat nodes+edges shape, threading edges through each branch
 *  in sequence and fanning out router modules to each route's first node. */
export function importMakeScenario(input: unknown): { graph: WorkflowGraph; name: string; warnings: string[] } {
  const doc = input as MakeBlueprint;
  if (!doc || !Array.isArray(doc.flow)) {
    throw new Error('Not a valid Make.com blueprint: missing "flow" array');
  }

  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];
  const warnings: string[] = [];
  let edgeIndex = 0;
  let x = 0;

  function walk(entries: MakeFlowEntry[], previousId: string | null): void {
    let prev = previousId;
    for (const entry of entries) {
      const mapped = entry.module ? MODULE_MAP[entry.module] : undefined;
      if (entry.module && !mapped) {
        warnings.push(`No FlowForge equivalent for Make module "${entry.module}" (id ${entry.id}) — imported as a code node.`);
      }
      const id = `make_${entry.id}`;
      nodes.push({
        id,
        type: mapped ?? 'code',
        label: entry.module,
        position: { x: (x += 220), y: 0 },
        params: mapped ? ((entry as MakeModule).mapper ?? {}) : { _makeOriginalModule: entry.module, _makeOriginal: (entry as MakeModule).mapper ?? {} },
      });
      if (prev) edges.push({ id: `make_edge_${edgeIndex++}`, source: prev, target: id });
      prev = id;

      if (entry.routes) {
        for (const route of entry.routes) {
          walk(route.flow, id);
        }
        prev = null; // router branches don't have a single "next" — caller must connect explicitly downstream
      }
    }
  }

  walk(doc.flow, null);

  return { graph: { nodes, edges }, name: doc.name ?? 'Imported from Make', warnings };
}
