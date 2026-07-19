import { Router } from 'express';
import { z } from 'zod';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import * as tar from 'tar';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';
import { createRedisConnection } from '../queue/queue';
import { searchRegistryIndex, withDownloadCounts, listCategories } from '../marketplace/registryIndex';

/**
 * Marketplace for third-party/community nodes. Installing a package
 * downloads its real npm tarball, extracts it into COMMUNITY_NODES_DIR
 * (shared with the worker via a mounted volume in docker-compose), records
 * it in the CommunityNode table, then publishes a Redis message so any
 * running worker picks it up via reloadCommunityNodes() without a restart.
 *
 * NOTE: installing arbitrary npm packages executes their code inside the
 * worker process — treat this the same as any other supply-chain surface.
 * requireAuth is enforced; wire in an admin-only check (e.g. req.user.role)
 * before exposing this beyond trusted operators in production.
 */
export const marketplaceRouter = Router();
marketplaceRouter.use(requireAuth);

const COMMUNITY_NODES_DIR = process.env.COMMUNITY_NODES_DIR ?? '/data/flowforge-community-nodes';
const RELOAD_CHANNEL = 'flowforge:community-nodes:reload';

const publisher = createRedisConnection();

async function notifyWorkersToReload() {
  await publisher.publish(RELOAD_CHANNEL, JSON.stringify({ at: new Date().toISOString() }));
}

/** GET /marketplace?query=airtable&category=CRM — browse the curated index, with real
 *  (or null-on-failure) monthly download counts attached per entry. */
marketplaceRouter.get('/', async (req, res, next) => {
  try {
    const query = typeof req.query.query === 'string' ? req.query.query : undefined;
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const entries = searchRegistryIndex(query, category);
    res.json(await withDownloadCounts(entries));
  } catch (err) {
    next(err);
  }
});

/** GET /marketplace/categories — distinct categories present in the curated index, for
 *  the client's category filter chips. */
marketplaceRouter.get('/categories', (_req, res) => {
  res.json(listCategories());
});

/** GET /marketplace/installed — list packages actually installed on this instance. */
marketplaceRouter.get('/installed', async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT * FROM "CommunityNode" ORDER BY "installedAt" DESC`);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

const installSchema = z.object({
  npmPackage: z.string().min(1),
  version: z.string().optional(), // defaults to "latest"
});

/**
 * POST /marketplace/install — resolves the package on the real npm
 * registry, downloads its tarball, extracts it, reads its `flowforge`
 * manifest field from package.json, and records the install.
 */
marketplaceRouter.post('/install', async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.userId!;
    const { npmPackage, version } = installSchema.parse(req.body);

    let metaResponse;
    try {
      metaResponse = await axios.get(`https://registry.npmjs.org/${encodeURIComponent(npmPackage)}/${version ?? 'latest'}`, {
        timeout: 15000,
      });
    } catch (fetchErr: any) {
      if (fetchErr?.response?.status === 404) {
        // Genuine npm 404 — the package/version doesn't exist on the real
        // registry. Some curated catalog entries here are illustrative
        // examples of the manifest shape (see registryIndex.ts) rather than
        // packages that are actually published; this isn't a FlowForge bug.
        return res.status(404).json({
          error: `"${npmPackage}${version ? `@${version}` : ''}" was not found on the public npm registry. Double-check the package name/version, or publish it first if this is your own package.`,
        });
      }
      throw fetchErr;
    }
    const meta = metaResponse.data as {
      name: string;
      version: string;
      description?: string;
      author?: { name?: string } | string;
      homepage?: string;
      dist: { tarball: string };
      flowforge?: { nodeTypes: string[]; description?: string; homepage?: string };
    };

    if (!meta.flowforge?.nodeTypes?.length) {
      return res.status(400).json({
        error: `"${npmPackage}" does not declare a "flowforge" field with nodeTypes in its package.json — it isn't a valid FlowForge community node package.`,
      });
    }

    const tarballResponse = await axios.get(meta.dist.tarball, { responseType: 'arraybuffer', timeout: 30000 });
    fs.mkdirSync(COMMUNITY_NODES_DIR, { recursive: true });
    const destDir = path.join(COMMUNITY_NODES_DIR, meta.name.replace(/[^a-zA-Z0-9_-]/g, '_'));
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });

    const tmpTarball = path.join(destDir, '_download.tgz');
    fs.writeFileSync(tmpTarball, Buffer.from(tarballResponse.data));
    // npm tarballs unpack into a top-level "package/" dir — strip: 1 flattens that.
    await tar.x({ file: tmpTarball, cwd: destDir, strip: 1 });
    fs.unlinkSync(tmpTarball);

    const authorName = typeof meta.author === 'string' ? meta.author : meta.author?.name;
    await pool.query(
      `INSERT INTO "CommunityNode" (id, name, version, description, author, homepage, "nodeTypes", source, "installedBy")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, 'npm', $7)
       ON CONFLICT (name) DO UPDATE SET version = $2, description = $3, "nodeTypes" = $6, "installedAt" = now()`,
      [meta.name, meta.version, meta.flowforge.description ?? meta.description ?? '', authorName ?? null, meta.flowforge.homepage ?? meta.homepage ?? null, JSON.stringify(meta.flowforge.nodeTypes), userId]
    );

    await notifyWorkersToReload();
    res.status(201).json({ installed: meta.name, version: meta.version, nodeTypes: meta.flowforge.nodeTypes });
  } catch (err) {
    next(err);
  }
});

/** GET /marketplace/latest/:name — check the latest published npm version, without installing. Powers the "update available" badge. */
marketplaceRouter.get('/latest/:name', async (req, res, next) => {
  try {
    const metaResponse = await axios.get(`https://registry.npmjs.org/${encodeURIComponent(req.params.name)}/latest`, {
      timeout: 15000,
    });
    const meta = metaResponse.data as { name: string; version: string };
    res.json({ name: meta.name, latestVersion: meta.version });
  } catch (err: any) {
    if (err?.response?.status === 404) return res.status(404).json({ error: 'Package not found on npm' });
    next(err);
  }
});

/** GET /marketplace/:name/versions — proxy npm's version list for a package, so the
 *  client can offer a real version picker instead of just "latest". Returns versions
 *  oldest-to-newest as published on npm; the client is expected to reverse for display. */
marketplaceRouter.get('/:name/versions', async (req, res, next) => {
  try {
    const metaResponse = await axios.get(`https://registry.npmjs.org/${encodeURIComponent(req.params.name)}`, {
      timeout: 15000,
    });
    const meta = metaResponse.data as { versions?: Record<string, unknown>; time?: Record<string, string> };
    const versions = Object.keys(meta.versions ?? {});
    res.json({
      name: req.params.name,
      versions: versions.map((v) => ({ version: v, publishedAt: meta.time?.[v] ?? null })),
    });
  } catch (err: any) {
    if (err?.response?.status === 404) return res.status(404).json({ error: 'Package not found on npm' });
    next(err);
  }
});

/** DELETE /marketplace/:name — uninstall a community node package. */
marketplaceRouter.delete('/:name', async (req, res, next) => {
  try {
    const name = req.params.name;
    const destDir = path.join(COMMUNITY_NODES_DIR, name.replace(/[^a-zA-Z0-9_-]/g, '_'));
    fs.rmSync(destDir, { recursive: true, force: true });
    await pool.query(`DELETE FROM "CommunityNode" WHERE name = $1`, [name]);
    await notifyWorkersToReload();
    res.json({ uninstalled: name });
  } catch (err) {
    next(err);
  }
});
