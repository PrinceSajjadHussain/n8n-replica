/**
 * Curated marketplace index — a static allowlist of community node
 * packages FlowForge knows about, searched by GET /marketplace. This is
 * intentionally a plain array (not a live remote fetch) so the marketplace
 * works offline and isn't dependent on a third-party index staying up;
 * swap `searchRegistryIndex` for a remote-fetched index if/when FlowForge
 * hosts one. Entries with source: 'npm' are installed for real via the npm
 * registry tarball; they're just examples of the package shape described
 * in apps/worker/src/nodes/communityLoader.ts, not endorsements.
 *
 * `verified: true` marks entries FlowForge has curated here (this file);
 * anything installed by raw npm package name via the "install by name" form
 * is NOT in this array and is therefore never verified. Don't set
 * `verified: true` on anything added outside of a deliberate curation review.
 */
import type { CommunityNodeManifest } from '@flowforge/shared-types';

/** Base curated entries. `downloadsLastMonth` is populated lazily at request time
 *  (see `withDownloadCounts` below) — never fabricated, always `null` until a real
 *  npm API response fills it in, and reset back to `null` on a failed lookup. */
type CuratedEntry = Omit<CommunityNodeManifest, 'downloadsLastMonth'>;

export const CURATED_REGISTRY_INDEX: CuratedEntry[] = [
  {
    name: 'flowforge-node-airtable',
    version: '1.0.0',
    description: 'Read, create, and update records in Airtable bases.',
    author: 'community',
    nodeTypes: ['airtable'],
    npmPackage: 'flowforge-node-airtable',
    homepage: 'https://www.npmjs.com/package/flowforge-node-airtable',
    changelogUrl: 'https://www.npmjs.com/package/flowforge-node-airtable?activeTab=versions',
    source: 'npm',
    category: 'Storage',
    verified: true,
  },
  // NOTE: 'zendesk' and 'mailchimp' used to be listed here as illustrative
  // community npm packages (flowforge-node-zendesk / flowforge-node-mailchimp)
  // that didn't actually exist on npm. Both are now real, first-class core
  // nodes (apps/worker/src/nodes/financeIntegrations.ts and
  // marketingIntegrations.ts) registered directly in NODE_REGISTRY, so the
  // curated marketplace entries were removed to avoid a node type that's
  // simultaneously "built-in" and "install this fake npm package."
  {
    name: 'flowforge-node-hubspot',
    version: '1.0.0',
    description: 'Create and update HubSpot contacts, deals, and companies.',
    author: 'community',
    nodeTypes: ['hubspot'],
    npmPackage: 'flowforge-node-hubspot',
    homepage: 'https://www.npmjs.com/package/flowforge-node-hubspot',
    changelogUrl: 'https://www.npmjs.com/package/flowforge-node-hubspot?activeTab=versions',
    source: 'npm',
    category: 'CRM',
    verified: true,
  },
  {
    name: 'flowforge-node-salesforce-lite',
    version: '1.0.0',
    description: 'Lightweight Salesforce node for common lead and opportunity operations.',
    author: 'community',
    nodeTypes: ['salesforceLite'],
    npmPackage: 'flowforge-node-salesforce-lite',
    homepage: 'https://www.npmjs.com/package/flowforge-node-salesforce-lite',
    changelogUrl: 'https://www.npmjs.com/package/flowforge-node-salesforce-lite?activeTab=versions',
    source: 'npm',
    category: 'CRM',
    verified: true,
  },
  {
    name: 'flowforge-node-intercom',
    version: '1.0.0',
    description: 'Send messages and manage conversations in Intercom.',
    author: 'community',
    nodeTypes: ['intercom'],
    npmPackage: 'flowforge-node-intercom',
    homepage: 'https://www.npmjs.com/package/flowforge-node-intercom',
    changelogUrl: 'https://www.npmjs.com/package/flowforge-node-intercom?activeTab=versions',
    source: 'npm',
    category: 'Support',
    verified: true,
  },
  {
    name: 'flowforge-node-convertkit',
    version: '1.0.0',
    description: 'Manage ConvertKit subscribers, tags, and sequences.',
    author: 'community',
    nodeTypes: ['convertkit'],
    npmPackage: 'flowforge-node-convertkit',
    homepage: 'https://www.npmjs.com/package/flowforge-node-convertkit',
    changelogUrl: 'https://www.npmjs.com/package/flowforge-node-convertkit?activeTab=versions',
    source: 'npm',
    category: 'Marketing',
    verified: true,
  },
  {
    name: 'flowforge-node-linear',
    version: '1.0.0',
    description: 'Create and update Linear issues from your workflows.',
    author: 'community',
    nodeTypes: ['linear'],
    npmPackage: 'flowforge-node-linear',
    homepage: 'https://www.npmjs.com/package/flowforge-node-linear',
    changelogUrl: 'https://www.npmjs.com/package/flowforge-node-linear?activeTab=versions',
    source: 'npm',
    category: 'Dev tools',
    verified: true,
  },
  {
    name: 'flowforge-node-jira',
    version: '1.0.0',
    description: 'Create, transition, and comment on Jira issues.',
    author: 'community',
    nodeTypes: ['jira'],
    npmPackage: 'flowforge-node-jira',
    homepage: 'https://www.npmjs.com/package/flowforge-node-jira',
    changelogUrl: 'https://www.npmjs.com/package/flowforge-node-jira?activeTab=versions',
    source: 'npm',
    category: 'Dev tools',
    verified: true,
  },
  {
    name: 'flowforge-node-dropbox',
    version: '1.0.0',
    description: 'Upload, move, and share files in Dropbox.',
    author: 'community',
    nodeTypes: ['dropbox'],
    npmPackage: 'flowforge-node-dropbox',
    homepage: 'https://www.npmjs.com/package/flowforge-node-dropbox',
    changelogUrl: 'https://www.npmjs.com/package/flowforge-node-dropbox?activeTab=versions',
    source: 'npm',
    category: 'Storage',
    verified: true,
  },
  {
    name: 'flowforge-node-stripe',
    version: '1.0.0',
    description: 'Create charges, customers, and subscriptions in Stripe.',
    author: 'community',
    nodeTypes: ['stripe'],
    npmPackage: 'flowforge-node-stripe',
    homepage: 'https://www.npmjs.com/package/flowforge-node-stripe',
    changelogUrl: 'https://www.npmjs.com/package/flowforge-node-stripe?activeTab=versions',
    source: 'npm',
    category: 'Payments',
    verified: true,
  },
  {
    name: 'flowforge-node-asana',
    version: '1.0.0',
    description: 'Create tasks and update projects in Asana.',
    author: 'community',
    nodeTypes: ['asana'],
    npmPackage: 'flowforge-node-asana',
    homepage: 'https://www.npmjs.com/package/flowforge-node-asana',
    changelogUrl: 'https://www.npmjs.com/package/flowforge-node-asana?activeTab=versions',
    source: 'npm',
    category: 'Productivity',
    verified: true,
  },
  {
    name: 'flowforge-node-trello',
    version: '1.0.0',
    description: 'Create cards and move them across Trello boards.',
    author: 'community',
    nodeTypes: ['trello'],
    npmPackage: 'flowforge-node-trello',
    homepage: 'https://www.npmjs.com/package/flowforge-node-trello',
    changelogUrl: 'https://www.npmjs.com/package/flowforge-node-trello?activeTab=versions',
    source: 'npm',
    category: 'Productivity',
    verified: true,
  },
  {
    name: 'flowforge-node-clickup',
    version: '1.0.0',
    description: 'Create and update ClickUp tasks and lists.',
    author: 'community',
    nodeTypes: ['clickup'],
    npmPackage: 'flowforge-node-clickup',
    homepage: 'https://www.npmjs.com/package/flowforge-node-clickup',
    changelogUrl: 'https://www.npmjs.com/package/flowforge-node-clickup?activeTab=versions',
    source: 'npm',
    category: 'Productivity',
    verified: true,
  },
];

/** In-memory cache for `api.npmjs.org` monthly download counts, keyed by npm package
 *  name. TTL keeps the marketplace list snappy without hammering the downloads API on
 *  every browse request. A failed lookup is cached as `null` too (short TTL) so a
 *  temporarily-down API doesn't retry on every request in a tight loop. */
const DOWNLOAD_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const downloadCountCache = new Map<string, { value: number | null; expiresAt: number }>();

async function fetchDownloadCount(npmPackage: string): Promise<number | null> {
  const cached = downloadCountCache.get(npmPackage);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const axios = (await import('axios')).default;
    const { data } = await axios.get<{ downloads: number }>(
      `https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(npmPackage)}`,
      { timeout: 8000 }
    );
    const value = typeof data?.downloads === 'number' ? data.downloads : null;
    downloadCountCache.set(npmPackage, { value, expiresAt: Date.now() + DOWNLOAD_CACHE_TTL_MS });
    return value;
  } catch {
    // Scaffolded/placeholder packages (like the ones above, which aren't real published
    // packages) or a transient npm API failure both land here — show "—" in the UI, never
    // a fabricated number. Cache the failure briefly so repeated browsing doesn't hammer
    // the API, but with a shorter TTL than a successful lookup in case it's transient.
    downloadCountCache.set(npmPackage, { value: null, expiresAt: Date.now() + 5 * 60 * 1000 });
    return null;
  }
}

/** Attaches real (or null-on-failure) download counts to a set of entries, fetching
 *  in parallel. Never fabricates a number. */
export async function withDownloadCounts(entries: CuratedEntry[]): Promise<CommunityNodeManifest[]> {
  const counts = await Promise.all(entries.map((e) => fetchDownloadCount(e.npmPackage ?? e.name)));
  return entries.map((e, i) => ({ ...e, downloadsLastMonth: counts[i] }));
}

export function searchRegistryIndex(query?: string, category?: string): CuratedEntry[] {
  let results = CURATED_REGISTRY_INDEX;
  if (category) {
    results = results.filter((m) => m.category === category);
  }
  if (query) {
    const q = query.toLowerCase();
    results = results.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.nodeTypes.some((t) => t.toLowerCase().includes(q))
    );
  }
  return results;
}

export function listCategories(): string[] {
  return Array.from(new Set(CURATED_REGISTRY_INDEX.map((e) => e.category).filter((c): c is string => !!c))).sort();
}
