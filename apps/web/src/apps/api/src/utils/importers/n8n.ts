import type { WorkflowGraph, WorkflowNode, WorkflowEdge, NodeType } from '@flowforge/shared-types';

interface N8nNode {
  name: string;
  type: string; // e.g. "n8n-nodes-base.httpRequest"
  position: [number, number];
  parameters?: Record<string, unknown>;
  credentials?: Record<string, { id?: string; name?: string }>;
}

interface N8nWorkflowExport {
  name?: string;
  nodes: N8nNode[];
  connections: Record<string, { main: { node: string; type: string; index: number }[][] }>;
}

/** Maps n8n's built-in node type strings to FlowForge's NodeType. Nodes with
 *  no direct equivalent fall back to `code` with the original params
 *  preserved under `_n8nOriginal`, so the import never silently drops a step. */
const TYPE_MAP: Record<string, NodeType> = {
  'n8n-nodes-base.webhook': 'webhook',
  'n8n-nodes-base.scheduleTrigger': 'schedule',
  'n8n-nodes-base.cron': 'schedule',
  'n8n-nodes-base.httpRequest': 'httpRequest',
  'n8n-nodes-base.if': 'if',
  'n8n-nodes-base.switch': 'switch',
  'n8n-nodes-base.merge': 'merge',
  'n8n-nodes-base.set': 'set',
  'n8n-nodes-base.code': 'code',
  'n8n-nodes-base.function': 'code',
  'n8n-nodes-base.emailSend': 'email',
  'n8n-nodes-base.slack': 'slack',
  'n8n-nodes-base.googleSheets': 'googleSheets',
  'n8n-nodes-base.openAi': 'openai',
  'n8n-nodes-base.wait': 'wait',
  'n8n-nodes-base.splitInBatches': 'forEach',
  'n8n-nodes-base.discord': 'discord',
  'n8n-nodes-base.telegram': 'telegram',
  'n8n-nodes-base.notion': 'notion',
  'n8n-nodes-base.github': 'github',
  'n8n-nodes-base.postgres': 'postgres',
  'n8n-nodes-base.stripe': 'stripe',
  'n8n-nodes-base.twilio': 'twilio',
  'n8n-nodes-base.hubspot': 'hubspot',
};

/** Converts a raw n8n workflow export (Settings → Download) into a
 *  FlowForge WorkflowGraph. Node ids are re-derived from n8n's node `name`
 *  since n8n doesn't expose stable ids in the export format; connections
 *  are translated from n8n's `{ sourceName: { main: [[{node, index}]] } }`
 *  shape into flat WorkflowEdge[]. */
export function importN8nWorkflow(input: unknown): { graph: WorkflowGraph; name: string; warnings: string[] } {
  const doc = input as N8nWorkflowExport;
  if (!doc || !Array.isArray(doc.nodes)) {
    throw new Error('Not a valid n8n workflow export: missing "nodes" array');
  }

  const warnings: string[] = [];
  const idByName = new Map<string, string>();
  doc.nodes.forEach((n, i) => idByName.set(n.name, `n8n_${i}_${slug(n.name)}`));

  const nodes: WorkflowNode[] = doc.nodes.map((n) => {
    const mapped = TYPE_MAP[n.type];
    if (!mapped) warnings.push(`No FlowForge equivalent for n8n node type "${n.type}" (node "${n.name}") — imported as a code node.`);
    return {
      id: idByName.get(n.name)!,
      type: mapped ?? 'code',
      label: n.name,
      position: { x: n.position?.[0] ?? 0, y: n.position?.[1] ?? 0 },
      params: mapped ? (n.parameters ?? {}) : { _n8nOriginalType: n.type, _n8nOriginal: n.parameters ?? {} },
    };
  });

  const edges: WorkflowEdge[] = [];
  let edgeIndex = 0;
  for (const [sourceName, conn] of Object.entries(doc.connections ?? {})) {
    const sourceId = idByName.get(sourceName);
    if (!sourceId) continue;
    for (const branch of conn.main ?? []) {
      for (const target of branch) {
        const targetId = idByName.get(target.node);
        if (!targetId) continue;
        edges.push({ id: `n8n_edge_${edgeIndex++}`, source: sourceId, target: targetId });
      }
    }
  }

  return { graph: { nodes, edges }, name: doc.name ?? 'Imported from n8n', warnings };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
}
