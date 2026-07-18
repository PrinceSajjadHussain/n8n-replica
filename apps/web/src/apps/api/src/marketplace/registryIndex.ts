/**
 * Curated marketplace index — a static allowlist of community node
 * packages FlowForge knows about, searched by GET /marketplace. This is
 * intentionally a plain array (not a live remote fetch) so the marketplace
 * works offline and isn't dependent on a third-party index staying up;
 * swap `searchRegistryIndex` for a remote-fetched index if/when FlowForge
 * hosts one. Entries with source: 'npm' are installed for real via the npm
 * registry tarball; they're just examples of the package shape described
 * in apps/worker/src/nodes/communityLoader.ts, not endorsements.
 */
import type { CommunityNodeManifest } from '@flowforge/shared-types';

export const CURATED_REGISTRY_INDEX: CommunityNodeManifest[] = [
  {
    name: 'flowforge-node-airtable',
    version: '1.0.0',
    description: 'Read, create, and update records in Airtable bases.',
    author: 'community',
    nodeTypes: ['airtable'],
    npmPackage: 'flowforge-node-airtable',
    homepage: 'https://www.npmjs.com/package/flowforge-node-airtable',
    source: 'npm',
  },
  {
    name: 'flowforge-node-zendesk',
    version: '1.0.0',
    description: 'Create and update Zendesk support tickets.',
    author: 'community',
    nodeTypes: ['zendesk'],
    npmPackage: 'flowforge-node-zendesk',
    homepage: 'https://www.npmjs.com/package/flowforge-node-zendesk',
    source: 'npm',
  },
  {
    name: 'flowforge-node-mailchimp',
    version: '1.0.0',
    description: 'Manage Mailchimp audiences, tags, and campaigns.',
    author: 'community',
    nodeTypes: ['mailchimp'],
    npmPackage: 'flowforge-node-mailchimp',
    homepage: 'https://www.npmjs.com/package/flowforge-node-mailchimp',
    source: 'npm',
  },
];

export function searchRegistryIndex(query?: string): CommunityNodeManifest[] {
  if (!query) return CURATED_REGISTRY_INDEX;
  const q = query.toLowerCase();
  return CURATED_REGISTRY_INDEX.filter(
    (m) => m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q) || m.nodeTypes.some((t) => t.toLowerCase().includes(q))
  );
}
