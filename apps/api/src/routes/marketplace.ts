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
import { searchRegistryIndex } from '../marketplace/registryIndex';

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

/** GET /marketplace?query=airtable — browse the curated index. */
marketplaceRouter.get('/', (req, res) => {
  const query = typeof req.query.query === 'string' ? req.query.query : undefined;
  res.json(searchRegistryIndex(query));
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

    const metaResponse = await axios.get(`https://registry.npmjs.org/${encodeURIComponent(npmPackage)}/${version ?? 'latest'}`, {
      timeout: 15000,
    });
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
