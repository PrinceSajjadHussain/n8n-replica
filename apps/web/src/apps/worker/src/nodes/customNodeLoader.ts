/**
 * CUSTOM NODE HOT-RELOAD LOADER
 * =============================
 * Distinct from `communityLoader.ts` (which loads marketplace-installed
 * packages once at boot/on-demand): this loader watches a local directory
 * of @flowforge/node-sdk-authored node packages and re-registers them the
 * moment their source changes — the workflow of `flowforge-node create`,
 * edit, save, and immediately re-test in the canvas without restarting the
 * worker.
 *
 * A watched package looks like what `flowforge-node create` scaffolds:
 *   my-node/
 *     package.json     <- must have a "flowforge": { entry, displayName, ... } field
 *     src/index.ts      <- default-exports a NodeDefinition (or an array of them)
 *
 * Registered types are namespaced `custom.<packageDirName>.<definition.type>`
 * so a locally-authored node can never silently shadow a built-in or
 * marketplace node type.
 */
import fs from 'fs';
import path from 'path';
import chokidar, { type FSWatcher } from 'chokidar';
import { registerNode } from './types';
import type { NodeExecutionContext, NodeExecutionResult } from './types';

const CUSTOM_NODES_DIR = process.env.CUSTOM_NODES_DIR ?? path.resolve(process.cwd(), 'custom-nodes');

interface SdkNodeDefinition {
  type: string;
  displayName: string;
  description: string;
  version: string;
  fields: unknown[];
  execute: (ctx: unknown) => Promise<unknown> | unknown;
}

interface FlowforgeManifest {
  displayName: string;
  description: string;
  entry: string;
}

const registeredByPackage = new Map<string, string[]>();
let watcher: FSWatcher | null = null;

function isSdkDefinition(value: unknown): value is SdkNodeDefinition {
  return !!value && typeof value === 'object' && typeof (value as SdkNodeDefinition).type === 'string' && typeof (value as SdkNodeDefinition).execute === 'function';
}

/** Adapts a node-sdk `NodeExecuteFn(ctx)` (items in, items out) to the
 *  worker's NodePlugin `execute(ExecutionContext) -> ExecutionResult` shape. */
function adapt(def: SdkNodeDefinition) {
  return async (ctx: NodeExecutionContext): Promise<NodeExecutionResult> => {
    const items = await def.execute({
      params: ctx.params,
      items: ctx.items,
      credential: ctx.credential ?? undefined,
      logger: {
        info: (msg: string, meta?: unknown) => console.log(`[custom-node:${def.type}]`, msg, meta ?? ''),
        warn: (msg: string, meta?: unknown) => console.warn(`[custom-node:${def.type}]`, msg, meta ?? ''),
        error: (msg: string, meta?: unknown) => console.error(`[custom-node:${def.type}]`, msg, meta ?? ''),
      },
      workflowId: 'unknown',
      executionId: 'unknown',
      nodeId: 'unknown',
    });
    return { items: Array.isArray(items) ? (items as NodeExecutionResult['items']) : [] };
  };
}

function loadPackage(dirName: string): string[] {
  const pkgDir = path.join(CUSTOM_NODES_DIR, dirName);
  const pkgJsonPath = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return [];

  try {
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    const manifest: FlowforgeManifest | undefined = pkgJson.flowforge;
    if (!manifest?.entry) {
      console.warn(`[custom-nodes] "${dirName}" package.json is missing a "flowforge.entry" field — skipping`);
      return [];
    }

    const entryPath = require.resolve(path.join(pkgDir, manifest.entry));
    delete require.cache[entryPath];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(entryPath);
    const exported = mod?.default ?? mod;
    const defs: SdkNodeDefinition[] = Array.isArray(exported) ? exported : [exported];

    const registeredTypes: string[] = [];
    for (const def of defs) {
      if (!isSdkDefinition(def)) continue;
      const namespacedType = `custom.${dirName}.${def.type}`;
      registerNode({ type: namespacedType, execute: adapt(def) });
      registeredTypes.push(namespacedType);
    }

    if (registeredTypes.length === 0) {
      console.warn(`[custom-nodes] "${dirName}" entry did not export a valid NodeDefinition — skipping`);
    } else {
      console.log(`[custom-nodes] loaded "${dirName}": ${registeredTypes.join(', ')}`);
    }
    return registeredTypes;
  } catch (err) {
    console.error(`[custom-nodes] failed to load "${dirName}":`, err instanceof Error ? err.message : err);
    return [];
  }
}

function loadAll(): void {
  if (!fs.existsSync(CUSTOM_NODES_DIR)) return;
  for (const dirName of fs.readdirSync(CUSTOM_NODES_DIR)) {
    const types = loadPackage(dirName);
    if (types.length) registeredByPackage.set(dirName, types);
  }
}

/** Starts watching CUSTOM_NODES_DIR for changes and hot-reloads the affected
 *  package on every add/change/unlink. No-op (with a log line) if the
 *  directory doesn't exist — most FlowForge deployments won't use this. */
export function startCustomNodeHotReload(): void {
  if (!fs.existsSync(CUSTOM_NODES_DIR)) {
    console.log(`[custom-nodes] ${CUSTOM_NODES_DIR} does not exist — hot-reload disabled`);
    return;
  }

  loadAll();

  watcher = chokidar.watch(CUSTOM_NODES_DIR, {
    ignoreInitial: true,
    ignored: /node_modules/,
    depth: 5,
  });

  const reloadForFile = (filePath: string) => {
    const relative = path.relative(CUSTOM_NODES_DIR, filePath);
    const dirName = relative.split(path.sep)[0];
    if (!dirName) return;
    console.log(`[custom-nodes] change detected in "${dirName}", reloading`);
    loadPackage(dirName);
  };

  watcher.on('add', reloadForFile).on('change', reloadForFile).on('unlink', reloadForFile);
  console.log(`[custom-nodes] watching ${CUSTOM_NODES_DIR} for hot-reload`);
}

export function stopCustomNodeHotReload(): void {
  watcher?.close();
  watcher = null;
}
