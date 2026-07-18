import { z } from 'zod';

// ---------------------------------------------------------------------------
// @flowforge/node-sdk
//
// Public API for building custom FlowForge nodes outside the monorepo. A
// node package exports one or more `NodeDefinition`s built with `defineNode`;
// the worker's custom-node loader (see apps/worker/src/customNodes/loader.ts)
// picks these up from a directory, hot-reloading on change.
// ---------------------------------------------------------------------------

export type FieldType = 'string' | 'number' | 'boolean' | 'json' | 'options' | 'credential' | 'expression';

export interface FieldOption {
  label: string;
  value: string;
}

export interface NodeField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  default?: unknown;
  description?: string;
  /** For type: 'options' */
  options?: FieldOption[];
  /** For type: 'credential' — restricts which credential kinds are selectable. */
  credentialType?: string;
}

export interface BinaryData {
  mimeType: string;
  fileName?: string;
  data?: string; // base64
}

export interface NodeItem {
  json: Record<string, unknown>;
  binary?: Record<string, BinaryData>;
}

export interface NodeContext {
  /** Resolved node parameters (after expression evaluation). */
  params: Record<string, unknown>;
  /** Items flowing into this node from its upstream connection(s). */
  items: NodeItem[];
  /** Decrypted credential data, if this node instance has one attached. */
  credential?: Record<string, unknown>;
  /** Structured logger — shows up in the execution's node-run log panel. */
  logger: { info: (msg: string, meta?: unknown) => void; warn: (msg: string, meta?: unknown) => void; error: (msg: string, meta?: unknown) => void };
  /** Workflow/execution identifiers, for nodes that need to correlate external state. */
  workflowId: string;
  executionId: string;
  nodeId: string;
}

export type NodeExecuteFn = (ctx: NodeContext) => Promise<NodeItem[]> | NodeItem[];

export interface NodeDefinition {
  /** Unique type string, namespaced by convention: "community.<package>.<node>". */
  type: string;
  displayName: string;
  description: string;
  /** Icon name or emoji shown in the palette. */
  icon?: string;
  /** Category used to group nodes in the palette (Trigger, Action, Transform, AI, ...). */
  category?: string;
  version: string;
  fields: NodeField[];
  /** Optional zod schema for stricter param validation than `fields` alone provides. */
  paramsSchema?: z.ZodTypeAny;
  execute: NodeExecuteFn;
}

/** Declares one custom node. Validates the definition shape at call time so
 *  authoring mistakes fail fast (at load time) instead of at execution time
 *  deep in a workflow run. */
export function defineNode(definition: NodeDefinition): NodeDefinition {
  if (!/^[a-zA-Z0-9_.-]+$/.test(definition.type)) {
    throw new Error(`Invalid node type "${definition.type}" — use only letters, numbers, dots, dashes, underscores.`);
  }
  if (!definition.execute) {
    throw new Error(`Node "${definition.type}" is missing an execute() function.`);
  }
  for (const field of definition.fields) {
    if (field.type === 'options' && (!field.options || field.options.length === 0)) {
      throw new Error(`Field "${field.key}" on node "${definition.type}" has type "options" but no options[].`);
    }
  }
  return definition;
}

/** Manifest shape for a node package's package.json `flowforge` field —
 *  read by both the CLI generator and the worker's hot-reload loader. */
export interface NodePackageManifest {
  name: string;
  version: string;
  displayName: string;
  description: string;
  author?: string;
  /** Relative path (from the package root) to the file exporting NodeDefinition(s). */
  entry: string;
}

export * from './testHarness';
