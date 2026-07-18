import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import AppShell from '../components/AppShell';

interface RegistryEntry {
  name: string;
  version: string;
  description: string;
  author?: string;
  nodeTypes: string[];
  npmPackage?: string;
  homepage?: string;
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

export default function MarketplacePage() {
  const [registry, setRegistry] = useState<RegistryEntry[] | null>(null);
  const [installed, setInstalled] = useState<InstalledPackage[] | null>(null);
  const [query, setQuery] = useState('');
  const [versionInputs, setVersionInputs] = useState<Record<string, string>>({});
  const [busyPackage, setBusyPackage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [latestVersions, setLatestVersions] = useState<Record<string, string>>({});
  const [checkingUpdates, setCheckingUpdates] = useState<string | null>(null);
  const [directName, setDirectName] = useState('');
  const [directVersion, setDirectVersion] = useState('');
  const [directBusy, setDirectBusy] = useState(false);

  async function loadRegistry(q?: string) {
    const { data } = await api.get('/marketplace', { params: q ? { query: q } : undefined });
    setRegistry(data);
  }

  async function loadInstalled() {
    const { data } = await api.get('/marketplace/installed');
    setInstalled(data);
  }

  useEffect(() => {
    loadRegistry();
    loadInstalled();
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => loadRegistry(query || undefined), 250);
    return () => clearTimeout(handle);
  }, [query]);

  const installedByName = useMemo(() => {
    const map = new Map<string, InstalledPackage>();
    for (const pkg of installed ?? []) map.set(pkg.name, pkg);
    return map;
  }, [installed]);

  async function handleInstall(entry: RegistryEntry, versionOverride?: string) {
    setError(null);
    setNotice(null);
    setBusyPackage(entry.name);
    try {
      const version = (versionOverride ?? versionInputs[entry.name] ?? '').trim() || undefined;
      const { data } = await api.post('/marketplace/install', {
        npmPackage: entry.npmPackage ?? entry.name,
        version,
      });
      setNotice(`Installed ${data.installed}@${data.version}.`);
      await loadInstalled();
    } catch (err: any) {
      setError(err.response?.data?.error ?? `Could not install "${entry.name}".`);
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
      const { data } = await api.post('/marketplace/install', { npmPackage: pkg.name });
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
      setError(err.response?.data?.error ?? `Could not update "${pkg.name}".`);
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

  async function handleDirectInstall(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!directName.trim()) return;
    setDirectBusy(true);
    try {
      const { data } = await api.post('/marketplace/install', {
        npmPackage: directName.trim(),
        version: directVersion.trim() || undefined,
      });
      setNotice(`Installed ${data.installed}@${data.version}.`);
      setDirectName('');
      setDirectVersion('');
      await loadInstalled();
    } catch (err: any) {
      setError(err.response?.data?.error ?? `Could not install "${directName}".`);
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
          <p className="text-muted text-sm">No community nodes installed yet — browse the index below.</p>
        )}
        <div className="grid gap-2">
          {installed?.map((pkg) => (
            <div key={pkg.id} className="border border-panelBorder rounded-lg px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{pkg.name}</span>
                    <span className="text-[10px] uppercase tracking-wide text-signal border border-signal/30 rounded px-1.5 py-0.5">
                      v{pkg.version}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-muted border border-panelBorder rounded px-1.5 py-0.5">
                      {pkg.source}
                    </span>
                  </div>
                  <p className="text-muted text-xs mt-1">{pkg.description}</p>
                  <p className="text-muted text-[11px] mt-1">
                    Nodes: {pkg.nodeTypes.map((t) => `community.${t}`).join(', ')} · installed{' '}
                    {new Date(pkg.installedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {latestVersions[pkg.name] && latestVersions[pkg.name] !== pkg.version ? (
                    <>
                      <span className="text-[10px] uppercase tracking-wide text-signal border border-signal/30 rounded px-1.5 py-0.5">
                        update available: v{latestVersions[pkg.name]}
                      </span>
                      <button
                        onClick={() => handleUpdate(pkg)}
                        disabled={busyPackage === pkg.name}
                        className="focus-ring bg-signal text-canvas text-xs font-medium px-3 py-1.5 rounded-md hover:brightness-110 transition disabled:opacity-50"
                      >
                        {busyPackage === pkg.name ? 'Updating…' : `Update to v${latestVersions[pkg.name]}`}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => checkLatest(pkg)}
                      disabled={checkingUpdates === pkg.name}
                      className="focus-ring text-xs border border-panelBorder rounded-md px-3 py-1.5 hover:bg-canvas transition disabled:opacity-50"
                    >
                      {checkingUpdates === pkg.name ? 'Checking…' : 'Check for updates'}
                    </button>
                  )}
                  <button
                    onClick={() => handleUninstall(pkg)}
                    disabled={busyPackage === pkg.name}
                    className="focus-ring text-xs text-muted hover:text-alert transition disabled:opacity-50"
                  >
                    Uninstall
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Install any npm package by name directly */}
      <div className="bg-panel border border-panelBorder rounded-xl p-5 mb-8">
        <h2 className="text-sm font-medium mb-1">Install by npm package name</h2>
        <p className="text-muted text-xs mb-3">
          Not in the curated index below? Install any public npm package that declares a{' '}
          <code>flowforge</code> field in its <code>package.json</code>.
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
      </div>

      {/* Browse curated index */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium">Browse index</h2>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, description, or node type…"
            className="focus-ring w-72 bg-canvas border border-panelBorder rounded-md px-3 py-1.5 text-sm"
          />
        </div>
        <div className="grid gap-2">
          {registry?.map((entry) => {
            const existing = installedByName.get(entry.name);
            return (
              <div key={entry.name} className="bg-panel border border-panelBorder rounded-lg px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{entry.name}</span>
                      <span className="text-[10px] uppercase tracking-wide text-muted border border-panelBorder rounded px-1.5 py-0.5">
                        latest {entry.version}
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
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      value={versionInputs[entry.name] ?? ''}
                      onChange={(e) => setVersionInputs((v) => ({ ...v, [entry.name]: e.target.value }))}
                      placeholder="version (optional)"
                      title="Pin a specific npm version, e.g. 1.2.0. Leave blank for latest."
                      className="focus-ring w-32 bg-canvas border border-panelBorder rounded-md px-2 py-1.5 text-xs"
                    />
                    <button
                      onClick={() => handleInstall(entry)}
                      disabled={busyPackage === entry.name}
                      className="focus-ring bg-signal text-canvas text-xs font-medium px-3 py-1.5 rounded-md hover:brightness-110 transition disabled:opacity-50"
                    >
                      {busyPackage === entry.name ? 'Working…' : existing ? 'Reinstall' : 'Install'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {registry?.length === 0 && (
            <div className="border border-dashed border-panelBorder rounded-xl p-10 text-center">
              <p className="text-muted">No packages match "{query}".</p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
