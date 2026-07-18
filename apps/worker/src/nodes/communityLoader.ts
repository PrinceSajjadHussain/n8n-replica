/**
 * COMMUNITY NODE SDK
 * ==================
 * Third-party integrations don't need to be merged into FlowForge core to
 * show up in the palette. A community node is just an npm package (or a
 * local folder, for development) that default-exports an array of
 * NodePlugin objects plus a `manifest`. Drop it in COMMUNITY_NODES_DIR
 * (installed there by the marketplace API — see apps/api/src/routes/
 * marketplace.ts) and the worker picks it up on the next boot/reload.
 *
 * PACKAGE SHAPE A THIRD-PARTY AUTHOR PUBLISHES:
 * ------------------------------------------------------------------
 *   my-flowforge-node/
 *     package.json        <- must include a "flowforge" field, see below
 *     dist/index.js        <- CommonJS entry, default export: { manifest, nodes }
 *
 *   package.json:
 *   {
 *     "name": "flowforge-node-airtable",
 *     "version": "1.0.0",
 *     "main": "dist/index.js",
 *     "flowforge": {
 *       "nodeTypes": ["airtable"],
 *       "description": "Read/write Airtable bases",
 *       "homepage": "https://github.com/you/flowforge-node-airtable"
 *     }
 *   }
 *
 *   dist/index.js (compiled from the author's TS source):
 *   module.exports = {
 *     manifest: { name: 'flowforge-node-airtable', version: '1.0.0', nodeTypes: ['airtable'], ... },
 *     nodes: [ { type: 'airtable', async execute(ctx) { ... } } ],
 *   };
 * ------------------------------------------------------------------
 * The loader below namespaces every registered type as
 * `community.<packageName>.<originalType>` so a careless third-party
 * `type: 'httpRequest'` can never shadow (or be shadowed by) a built-in.
 */
import fs from 'fs';
import path from 'path';
import { registerNode } from './types';
import type { NodePlugin } from './types';
import type { CommunityNodeManifest } from '@flowforge/shared-types';

export interface LoadedCommunityPackage {
  manifest: CommunityNodeManifest;
  registeredTypes: string[];
}

const COMMUNITY_NODES_DIR = process.env.COMMUNITY_NODES_DIR ?? '/data/flowforge-community-nodes';

interface CommunityModuleExport {
  manifest: Omit<CommunityNodeManifest, 'source'>;
  nodes: NodePlugin[];
}

function isValidExport(mod: unknown): mod is CommunityModuleExport {
  if (!mod || typeof mod !== 'object') return false;
  const m = mod as Partial<CommunityModuleExport>;
  return !!m.manifest && Array.isArray(m.nodes) && m.nodes.every((n) => typeof n?.type === 'string' && typeof n?.execute === 'function');
}

/**
 * Scans COMMUNITY_NODES_DIR (one subdirectory per installed package),
 * requires each package's `main` entry, validates its export shape, and
 * registers every node under a `community.<pkg>.<type>` key. Failures in
 * one package are logged and skipped rather than crashing the worker.
 */
export function loadCommunityNodes(): LoadedCommunityPackage[] {
  const loaded: LoadedCommunityPackage[] = [];
  if (!fs.existsSync(COMMUNITY_NODES_DIR)) return loaded;

  for (const dirName of fs.readdirSync(COMMUNITY_NODES_DIR)) {
    const pkgDir = path.join(COMMUNITY_NODES_DIR, dirName);
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) continue;

    try {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      const entry = path.join(pkgDir, pkgJson.main ?? 'index.js');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(entry);
      const exported: unknown = mod?.default ?? mod;

      if (!isValidExport(exported)) {
        console.error(`[community-nodes] "${dirName}" did not export { manifest, nodes } — skipping`);
        continue;
      }

      const registeredTypes: string[] = [];
      for (const node of exported.nodes) {
        const namespacedType = `community.${exported.manifest.name}.${node.type}`;
        registerNode({ type: namespacedType, execute: node.execute });
        registeredTypes.push(namespacedType);
      }

      loaded.push({
        manifest: { ...exported.manifest, source: 'local' },
        registeredTypes,
      });
      console.log(`[community-nodes] loaded "${exported.manifest.name}"@${exported.manifest.version}: ${registeredTypes.join(', ')}`);
    } catch (err) {
      console.error(`[community-nodes] failed to load "${dirName}":`, err instanceof Error ? err.message : err);
    }
  }

  return loaded;
}

/** Re-scans and (re-)registers community nodes without a full process restart — call after a marketplace install/uninstall. */
export function reloadCommunityNodes(): LoadedCommunityPackage[] {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(COMMUNITY_NODES_DIR)) delete require.cache[key];
  }
  return loadCommunityNodes();
}
