import { createContext, useContext } from 'react';

/**
 * Node card density, mirroring Make.com's zoom-linked card sizing:
 *  - compact: icon + type only, ~120px, no run badge (dense 40-node canvases).
 *  - comfortable: current default — icon + label + type + run badge.
 *  - expanded: adds a live output preview + full credential name.
 *
 * This lives in canvas UI state only (a plain React context set from
 * CanvasPage's toolbar), never in node.data/params, so it's never part of the
 * saved workflow JSON and never round-trips through workflowsRouter.put().
 */
export type NodeDensity = 'compact' | 'comfortable' | 'expanded';

export const NodeDensityContext = createContext<NodeDensity>('comfortable');

export function useNodeDensity(): NodeDensity {
  return useContext(NodeDensityContext);
}

export const NODE_DENSITY_OPTIONS: { value: NodeDensity; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'expanded', label: 'Expanded' },
];

/**
 * Credential id -> display name, so the Expanded tier can show "Slack:
 * marketing-bot" instead of just a presence dot without every FlowNode
 * re-fetching /credentials itself. Provided by CanvasPage from the
 * credentials list it already loads.
 */
export const CredentialNamesContext = createContext<Record<string, string>>({});

export function useCredentialName(id: string | null | undefined): string | null {
  const names = useContext(CredentialNamesContext);
  if (!id) return null;
  return names[id] ?? null;
}
