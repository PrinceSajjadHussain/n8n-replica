import type { WorkflowGraph, WorkflowNode, WorkflowEdge, NodeType } from '@flowforge/shared-types';

interface ZapierStep {
  id: string;
  app: string; // e.g. "webhook", "gmail", "slack"
  action: string; // e.g. "send_message"
  params?: Record<string, unknown>;
}

interface ZapierExport {
  title?: string;
  steps: ZapierStep[]; // Zapier zaps are a linear trigger + action chain
}

const APP_MAP: Record<string, NodeType> = {
  webhook: 'webhook',
  schedule: 'schedule',
  webhooks_by_zapier: 'webhook',
  http: 'httpRequest',
  filter: 'if',
  formatter: 'set',
  code: 'code',
  email: 'email',
  gmail: 'email',
  slack: 'slack',
  google_sheets: 'googleSheets',
  openai: 'openai',
  delay: 'wait',
  discord: 'discord',
  telegram: 'telegram',
  notion: 'notion',
  github: 'github',
  postgresql: 'postgres',
  stripe: 'stripe',
  twilio: 'twilio',
  hubspot: 'hubspot',
};

/** Converts a Zapier zap export into a FlowForge WorkflowGraph. Zaps are
 *  strictly linear (trigger, then a sequence of actions), so this is a
 *  straight 1:1 chain — much simpler than the n8n/Make importers, which have
 *  to handle branching. */
export function importZapierZap(input: unknown): { graph: WorkflowGraph; name: string; warnings: string[] } {
  const doc = input as ZapierExport;
  if (!doc || !Array.isArray(doc.steps)) {
    throw new Error('Not a valid Zapier export: missing "steps" array');
  }

  const warnings: string[] = [];
  const nodes: WorkflowNode[] = doc.steps.map((step, i) => {
    const mapped = APP_MAP[step.app];
    if (!mapped) warnings.push(`No FlowForge equivalent for Zapier app "${step.app}" (step ${i + 1}) — imported as a code node.`);
    return {
      id: `zapier_${i}_${step.id}`,
      type: mapped ?? 'code',
      label: `${step.app}: ${step.action}`,
      position: { x: i * 220, y: 0 },
      params: mapped ? (step.params ?? {}) : { _zapierOriginalApp: step.app, _zapierOriginalAction: step.action, _zapierOriginal: step.params ?? {} },
    };
  });

  const edges: WorkflowEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ id: `zapier_edge_${i}`, source: nodes[i].id, target: nodes[i + 1].id });
  }

  return { graph: { nodes, edges }, name: doc.title ?? 'Imported from Zapier', warnings };
}
