import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import AppShell from '../components/AppShell';
import { findBrandIconByName } from '../components/NodeIcon';
import { Package as PackageIcon, BadgeCheck } from 'lucide-react';
import FilterPillGroup from '../components/ui/FilterPillGroup';
import Badge from '../components/ui/Badge';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';

/** Real vector icon for a marketplace entry — brand mark when `simple-icons`
 *  has one matching the package name, generic package glyph otherwise. Same
 *  icon system as the canvas/palette, just resolved by name instead of node type. */
function MarketplaceIcon({ name, size = 28 }: { name: string; size?: number }) {
  const icon = findBrandIconByName(name);
  if (icon) {
    return (
      <svg role="img" viewBox="0 0 24 24" width={size} height={size} fill={`#${icon.hex}`} aria-label={icon.title}>
        <path d={icon.path} />
      </svg>
    );
  }
  return <PackageIcon size={size * 0.7} className="text-muted" />;
}

interface RegistryEntry {
  name: string;
  version: string;
  description: string;
  author?: string;
  nodeTypes: string[];
  npmPackage?: string;
  homepage?: string;
  changelogUrl?: string;
  category?: string;
  verified?: boolean;
  downloadsLastMonth?: number | null;
  source: 'registry' | 'npm' | 'local';
}

interface InstalledPackage {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string | null;
  homepage: string | null;
  nodeTypes: string[];
  source: string;
  installedBy: string;
  installedAt: string;
}

/** Known steps of the real server-side install flow in `routes/marketplace.ts`
 *  (resolve npm metadata → download tarball → extract → record + notify workers).
 *  There's no fine-grained progress channel from the server for a single POST
 *  request, so this animates through the stages on a fixed cadence while the
 *  real request is in flight, and is labelled "approximate" in the UI — it never
 *  claims "Registering nodes" is done before the request itself has resolved. */
const INSTALL_STAGES = ['Resolving', 'Downloading', 'Extracting', 'Registering nodes'] as const;
type InstallStage = (typeof INSTALL_STAGES)[number];

function formatDownloads(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function MarketplacePage() {
  const [registry, setRegistry] = useState<RegistryEntry[] | null>(null);
  const [installed, setInstalled] = useState<InstalledPackage[] | null>(null);
  const [query, setQuery] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [versionInputs, setVersionInputs] = useState<Record<string, string>>({});
  const [versionOptions, setVersionOptions] = useState<Record<string, string[]>>({});
  const [versionsLoading, setVersionsLoading] = useState<string | null>(null);
  const [busyPackage, setBusyPackage] = useState<string | null>(null);
  const [installStage, setInstallStage] = useState<InstallStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [latestVersions, setLatestVersions] = useState<Record<string, string>>({});
  const [checkingUpdates, setCheckingUpdates] = useState<string | null>(null);
  const [directName, setDirectName] = useState('');
  const [directVersion, setDirectVersion] = useState('');
  const [directBusy, setDirectBusy] = useState(false);

  async function loadRegistry(q?: string, category?: string | null) {
    const { data } = await api.get('/marketplace', {
      params: { ...(q ? { query: q } : {}), ...(category ? { category } : {}) },
    });
    setRegistry(data);
  }

  async function loadCategories() {
    const { data } = await api.get('/marketplace/categories');
    setCategories(data);
  }

  async function loadInstalled() {
    const { data } = await api.get('/marketplace/installed');
    setInstalled(data);
  }

  // Auto-check for updates on every installed package once, on page load — powers the
  // "update available" badge without requiring a manual click per package.
  async function checkAllInstalledForUpdates(pkgs: InstalledPackage[]) {
    for (const pkg of pkgs) {
      try {
        const { data } = await api.get(`/marketplace/latest/${encodeURIComponent(pkg.name)}`);
        setLatestVersions((v) => ({ ...v, [pkg.name]: data.latestVersion }));
      } catch {
        // Silently skip — packages that aren't real published npm packages (e.g. local
        // scaffolds) will 404 here; that's not worth surfacing as an error banner.
      }
    }
  }

  useEffect(() => {
    loadRegistry();
    loadCategories();
    loadInstalled();
  }, []);

  useEffect(() => {
    if (installed && installed.length > 0) checkAllInstalledForUpdates(installed);
    // Only re-run when the installed list identity changes (e.g. after install/uninstall),
    // not on every latestVersions update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installed]);

  useEffect(() => {
    const handle = setTimeout(() => loadRegistry(query || undefined, activeCategory), 250);
    return () => clearTimeout(handle);
  }, [query, activeCategory]);

  const installedByName = useMemo(() => {
    const map = new Map<string, InstalledPackage>();
    for (const pkg of installed ?? []) map.set(pkg.name, pkg);
    return map;
  }, [installed]);

  async function loadVersions(entry: RegistryEntry) {
    const pkgName = entry.npmPackage ?? entry.name;
    if (versionOptions[pkgName] || versionsLoading === pkgName) return;
    setVersionsLoading(pkgName);
    try {
      const { data } = await api.get(`/marketplace/${encodeURIComponent(pkgName)}/versions`);
      const versions = (data.versions as { version: string }[]).map((v) => v.version).reverse();
      setVersionOptions((v) => ({ ...v, [pkgName]: versions }));
    } catch {
      // No published versions found (likely a scaffolded/placeholder package name) —
      // leave the dropdown empty and fall back to the free-text version input.
      setVersionOptions((v) => ({ ...v, [pkgName]: [] }));
    } finally {
      setVersionsLoading(null);
    }
  }

  /** Runs the approximate client-side stage animation alongside the real install
   *  request. Stages only advance while the request is still in flight; the final
   *  "Registering nodes" label is shown once the request completes successfully —
   *  it is never marked done before the server has actually responded. */
  async function runInstall(npmPackage: string, version: string | undefined): Promise<any> {
    let stageIndex = 0;
    setInstallStage(INSTALL_STAGES[0]);
    const ticker = setInterval(() => {
      stageIndex = Math.min(stageIndex + 1, INSTALL_STAGES.length - 2); // hold before the last stage until the request resolves
      setInstallStage(INSTALL_STAGES[stageIndex]);
    }, 700);
    try {
      const { data } = await api.post('/marketplace/install', { npmPackage, version });
      setInstallStage(INSTALL_STAGES[INSTALL_STAGES.length - 1]);
      return data;
    } finally {
      clearInterval(ticker);
      setTimeout(() => setInstallStage(null), 400);
    }
  }

  async function handleInstall(entry: RegistryEntry, versionOverride?: string) {
    setError(null);
    setNotice(null);
    setBusyPackage(entry.name);
    try {
      const version = (versionOverride ?? versionInputs[entry.name] ?? '').trim() || undefined;
      const data = await runInstall(entry.npmPackage ?? entry.name, version);
      setNotice(`Installed ${data.installed}@${data.version}.`);
      await loadInstalled();
    } catch (err: any) {
      setError(err.response?.data?.error ?? `Could not install "${entry.name}". ${describeInstallFailure(err)}`);
    } finally {
      setBusyPackage(null);
    }
  }

  async function handleUpdate(pkg: InstalledPackage) {
    setError(null);
    setNotice(null);
    setBusyPackage(pkg.name);
    try {
      // Re-running install with no version pin resolves and installs "latest".
      const data = await runInstall(pkg.name, undefined);
      setNotice(
        data.version === pkg.version
          ? `${pkg.name} is already on the latest version (${pkg.version}).`
          : `Updated ${pkg.name} from ${pkg.version} to ${data.version}.`
      );
      setLatestVersions((v) => {
        const next = { ...v };
        delete next[pkg.name];
        return next;
      });
      await loadInstalled();
    } catch (err: any) {
      setError(err.response?.data?.error ?? `Could not update "${pkg.name}". ${describeInstallFailure(err)}`);
    } finally {
      setBusyPackage(null);
    }
  }

  async function checkLatest(pkg: InstalledPackage) {
    setError(null);
    setCheckingUpdates(pkg.name);
    try {
      const { data } = await api.get(`/marketplace/latest/${encodeURIComponent(pkg.name)}`);
      setLatestVersions((v) => ({ ...v, [pkg.name]: data.latestVersion }));
      if (data.latestVersion === pkg.version) {
        setNotice(`${pkg.name} is already on the latest version (${pkg.version}).`);
      }
    } catch (err: any) {
      setError(err.response?.data?.error ?? `Could not check the latest version of "${pkg.name}".`);
    } finally {
      setCheckingUpdates(null);
    }
  }

  function describeInstallFailure(err: any): string {
    if (!err.response) return 'The request could not reach the server — check your network connection.';
    if (err.response.status === 404) return 'That package name could not be found on npm.';
    if (err.response.status >= 500) return 'The server hit an error while installing — check the API logs.';
    return '';
  }

  async function handleDirectInstall(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!directName.trim()) return;
    setDirectBusy(true);
    try {
      const data = await runInstall(directName.trim(), directVersion.trim() || undefined);
      setNotice(`Installed ${data.installed}@${data.version}.`);
      setDirectName('');
      setDirectVersion('');
      await loadInstalled();
    } catch (err: any) {
      setError(err.response?.data?.error ?? `Could not install "${directName}". ${describeInstallFailure(err)}`);
    } finally {
      setDirectBusy(false);
    }
  }

  async function handleUninstall(pkg: InstalledPackage) {
    if (!confirm(`Uninstall "${pkg.name}"? Workflows using its nodes will fail until reinstalled.`)) return;
    setError(null);
    setNotice(null);
    setBusyPackage(pkg.name);
    try {
      await api.delete(`/marketplace/${encodeURIComponent(pkg.name)}`);
      setNotice(`Uninstalled ${pkg.name}.`);
      await loadInstalled();
    } catch (err: any) {
      setError(err.response?.data?.error ?? `Could not uninstall "${pkg.name}".`);
    } finally {
      setBusyPackage(null);
    }
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Community nodes</h1>
        <p className="text-muted text-sm mt-1">
          Installs a real npm package into the worker. Treat installs like any other supply-chain surface —
          only add packages you trust.
        </p>
      </div>

      {notice && (
        <div className="text-sm bg-signal/10 border border-signal/30 rounded-md px-3 py-2 mb-4">{notice}</div>
      )}
      {error && (
        <div className="text-alert text-sm bg-alert/10 border border-alert/30 rounded-md px-3 py-2 mb-4">
          {error}
        </div>
      )}

      {/* Installed packages */}
      <div className="bg-panel border border-panelBorder rounded-xl p-5 mb-8">
        <h2 className="text-sm font-medium mb-3">Installed ({installed?.length ?? 0})</h2>
        {installed?.length === 0 && (
          <p className="text-muted text-sm">Nothing installed yet — browse the catalog below.</p>
        )}
        <div className="grid gap-2">
          {installed?.map((pkg) => (
            <Card key={pkg.id}>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{pkg.name}</span>
                    <Badge variant="signal">v{pkg.version}</Badge>
                    <Badge variant="neutral">{pkg.source}</Badge>
                  </div>
                  <p className="text-muted text-xs mt-1">{pkg.description}</p>
                  <p className="text-muted text-[11px] mt-1">
                    Nodes: {pkg.nodeTypes.map((t) => `community.${t}`).join(', ')} · installed{' '}
                    {new Date(pkg.installedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {busyPackage === pkg.name && installStage ? (
                    <InstallProgress stage={installStage} />
                  ) : latestVersions[pkg.name] && latestVersions[pkg.name] !== pkg.version ? (
                    <>
                      <Badge variant="signal">update available: v{latestVersions[pkg.name]}</Badge>
                      <Button
                        variant="primary"
                        onClick={() => handleUpdate(pkg)}
                        loading={busyPackage === pkg.name}
                      >
                        {busyPackage === pkg.name ? 'Updating…' : `Update to v${latestVersions[pkg.name]}`}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() => checkLatest(pkg)}
                      loading={checkingUpdates === pkg.name}
                    >
                      {checkingUpdates === pkg.name ? 'Checking…' : 'Check for updates'}
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => handleUninstall(pkg)} loading={busyPackage === pkg.name}>
                    Uninstall
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Install any npm package by name directly */}
      <div className="bg-panel border border-panelBorder rounded-xl p-5 mb-8">
        <h2 className="text-sm font-medium mb-1">Install by npm package name</h2>
        <p className="text-muted text-xs mb-3">
          Not in the curated index below? Install any public npm package that declares a{' '}
          <code>flowforge</code> field in its <code>package.json</code>. Direct installs are never marked
          "verified" — that badge is reserved for the curated catalog below.
        </p>
        <form onSubmit={handleDirectInstall} className="flex items-center gap-2">
          <input
            value={directName}
            onChange={(e) => setDirectName(e.target.value)}
            placeholder="npm package name, e.g. flowforge-node-airtable"
            className="focus-ring flex-1 bg-canvas border border-panelBorder rounded-md px-3 py-1.5 text-sm"
          />
          <input
            value={directVersion}
            onChange={(e) => setDirectVersion(e.target.value)}
            placeholder="version (optional)"
            className="focus-ring w-40 bg-canvas border border-panelBorder rounded-md px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={directBusy || !directName.trim()}
            className="focus-ring bg-signal text-canvas text-sm font-medium px-4 py-1.5 rounded-md hover:brightness-110 transition disabled:opacity-50"
          >
            {directBusy ? 'Installing…' : 'Install'}
          </button>
        </form>
        {directBusy && installStage && (
          <div className="mt-3">
            <InstallProgress stage={installStage} />
          </div>
        )}
      </div>

      {/* Browse curated index */}
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <h2 className="text-sm font-medium">Browse index</h2>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, description, or node type…"
            className="focus-ring w-72 bg-canvas border border-panelBorder rounded-md px-3 py-1.5 text-sm"
          />
        </div>

        <FilterPillGroup
          mode="single"
          options={categories.map((cat) => ({ value: cat, label: cat }))}
          value={activeCategory}
          onChange={setActiveCategory}
          aria-label="Filter by category"
          className="mb-4"
        />

        <div className="grid gap-2">
          {registry?.map((entry) => {
            const existing = installedByName.get(entry.name);
            const pkgName = entry.npmPackage ?? entry.name;
            const options = versionOptions[pkgName];
            const isBusy = busyPackage === entry.name;
            return (
              <div key={entry.name} className="bg-panel border border-panelBorder rounded-lg px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="w-9 h-9 rounded-lg bg-canvas border border-panelBorder flex items-center justify-center shrink-0">
                    <MarketplaceIcon name={pkgName} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{entry.name}</span>
                      {entry.verified ? (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-signal border border-signal/30 rounded px-1.5 py-0.5"
                          title="Curated and reviewed by FlowForge"
                        >
                          <BadgeCheck size={11} /> verified · official
                        </span>
                      ) : (
                        <span className="text-[10px] uppercase tracking-wide text-muted border border-panelBorder rounded px-1.5 py-0.5">
                          community
                        </span>
                      )}
                      {entry.category && (
                        <span className="text-[10px] uppercase tracking-wide text-muted border border-panelBorder rounded px-1.5 py-0.5">
                          {entry.category}
                        </span>
                      )}
                      <span className="text-[10px] uppercase tracking-wide text-muted border border-panelBorder rounded px-1.5 py-0.5">
                        latest {entry.version}
                      </span>
                      <span className="text-[10px] text-muted">
                        {formatDownloads(entry.downloadsLastMonth)} downloads/mo
                      </span>
                      {existing && (
                        <span className="text-[10px] uppercase tracking-wide text-signal border border-signal/30 rounded px-1.5 py-0.5">
                          installed v{existing.version}
                        </span>
                      )}
                    </div>
                    <p className="text-muted text-xs mt-1">{entry.description}</p>
                    <p className="text-muted text-[11px] mt-1">
                      Nodes: {entry.nodeTypes.map((t) => `community.${t}`).join(', ')}
                      {entry.author ? ` · by ${entry.author}` : ''}
                      {entry.homepage && (
                        <>
                          {' · '}
                          <a
                            href={entry.homepage}
                            target="_blank"
                            rel="noreferrer"
                            className="text-signal hover:underline"
                          >
                            homepage
                          </a>
                        </>
                      )}
                      {entry.changelogUrl && (
                        <>
                          {' · '}
                          <a
                            href={entry.changelogUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-signal hover:underline"
                          >
                            changelog
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {isBusy && installStage ? (
                      <InstallProgress stage={installStage} />
                    ) : (
                      <div className="flex items-center gap-2">
                        {options && options.length > 0 ? (
                          <select
                            value={versionInputs[entry.name] ?? ''}
                            onChange={(e) => setVersionInputs((v) => ({ ...v, [entry.name]: e.target.value }))}
                            onFocus={() => loadVersions(entry)}
                            className="focus-ring w-32 bg-canvas border border-panelBorder rounded-md px-2 py-1.5 text-xs"
                          >
                            <option value="">latest</option>
                            {options.map((v) => (
                              <option key={v} value={v}>
                                {v}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={versionInputs[entry.name] ?? ''}
                            onChange={(e) => setVersionInputs((v) => ({ ...v, [entry.name]: e.target.value }))}
                            onFocus={() => loadVersions(entry)}
                            placeholder={versionsLoading === pkgName ? 'loading versions…' : 'version (optional)'}
                            title="Pin a specific npm version, e.g. 1.2.0. Leave blank for latest."
                            className="focus-ring w-32 bg-canvas border border-panelBorder rounded-md px-2 py-1.5 text-xs"
                          />
                        )}
                        <button
                          onClick={() => handleInstall(entry)}
                          disabled={isBusy}
                          className="focus-ring bg-signal text-canvas text-xs font-medium px-3 py-1.5 rounded-md hover:brightness-110 transition disabled:opacity-50"
                        >
                          {existing ? 'Reinstall' : 'Install'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {registry?.length === 0 && (
            <div className="border border-dashed border-panelBorder rounded-xl p-10 text-center">
              <p className="text-muted">
                No packages match {query ? `"${query}"` : ''}
                {activeCategory ? ` in ${activeCategory}` : ''}.
              </p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

/** Approximate install-progress indicator. Labelled "approximate" per-stage since the
 *  install endpoint is a single request/response, not a streamed progress channel —
 *  this reflects real elapsed-time stages of that request, not verified server events. */
function InstallProgress({ stage }: { stage: InstallStage }) {
  const idx = INSTALL_STAGES.indexOf(stage);
  return (
    <div className="flex items-center gap-2" title="Approximate progress — not a live server event stream">
      <div className="flex items-center gap-1">
        {INSTALL_STAGES.map((s, i) => (
          <span
            key={s}
            className={`w-1.5 h-1.5 rounded-full transition ${i <= idx ? 'bg-signal' : 'bg-panelBorder'}`}
          />
        ))}
      </div>
      <span className="text-xs text-muted">{stage}…</span>
    </div>
  );
}
