/**
 * MIGRATION RUNNER
 * ================
 * Applies every SQL file under prisma/migrations/<timestamp>_<name>/migration.sql
 * that hasn't been applied yet, in folder-name order, each inside its own
 * transaction. Tracks what's been applied in a `_flowforge_migrations` table
 * it creates itself.
 *
 * Deliberately NOT `prisma migrate deploy`: this project's migrations have
 * historically been applied by hand with `psql -f migration.sql` (see the
 * setup guide / earlier docker compose sessions), so Prisma's own
 * `_prisma_migrations` bookkeeping table was never created or populated.
 * Running `prisma migrate deploy` against a database in that state makes
 * Prisma think NO migrations have been applied and try to replay
 * `00000000000000_init` from scratch — which fails with "relation already
 * exists" the moment any table is present. This script sidesteps that
 * entirely: it tracks applied migrations itself, is safe to run repeatedly,
 * and only ever applies what's actually missing.
 *
 * Usage:
 *   tsx src/scripts/migrate.ts
 *   # or, once built:
 *   node dist/scripts/migrate.js
 *
 * Requires DATABASE_URL in the environment (same variable the app itself uses).
 */
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'prisma', 'migrations');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[migrate] DATABASE_URL is not set — nothing to connect to.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "_flowforge_migrations" (
        name TEXT PRIMARY KEY,
        "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const alreadyApplied = new Set(
      (await pool.query<{ name: string }>(`SELECT name FROM "_flowforge_migrations"`)).rows.map((r) => r.name)
    );

    const folders = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    if (folders.length === 0) {
      console.log('[migrate] no migration folders found under', MIGRATIONS_DIR);
      return;
    }

    // BASELINING: this project's migrations have often been applied by hand
    // (`psql -f migration.sql`) before this tracker existed, so on a
    // database that already has tables but an empty tracker, we'd otherwise
    // try to re-create things that already exist and fail. Walk migrations
    // in order and auto-mark a migration as already applied if every SQL
    // object it touches (new tables, new enum types, new columns added to
    // existing tables) is already present — stopping at the first
    // migration where something is missing, which is where real
    // application resumes.
    if (alreadyApplied.size === 0) {
      for (const folder of folders) {
        const sqlPath = path.join(MIGRATIONS_DIR, folder, 'migration.sql');
        if (!fs.existsSync(sqlPath)) continue;
        const sql = fs.readFileSync(sqlPath, 'utf8');

        const tables = Array.from(sql.matchAll(/CREATE TABLE "([^"]+)"/g)).map((m) => m[1]);
        const types = Array.from(sql.matchAll(/CREATE TYPE "([^"]+)"/g)).map((m) => m[1]);

        // ALTER TABLE statements can span multiple lines and add several
        // columns in one statement (`ALTER TABLE "X"\n  ADD COLUMN "a" ...,\n  ADD COLUMN "b" ...;`),
        // so parse per-statement rather than with a single-line regex.
        const addedColumns: { table: string; column: string }[] = [];
        for (const statement of sql.split(';')) {
          const tableMatch = statement.match(/ALTER TABLE\s+"([^"]+)"/);
          if (!tableMatch) continue;
          const table = tableMatch[1];
          for (const colMatch of statement.matchAll(/ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"([^"]+)"/g)) {
            addedColumns.push({ table, column: colMatch[1] });
          }
        }


        if (tables.length === 0 && types.length === 0 && addedColumns.length === 0) {
          // Nothing this script knows how to check existence for (pure
          // index/constraint changes, data migrations, etc) — baselining
          // stops here; this migration and everything after it gets
          // applied for real below.
          break;
        }

        const allTablesExist =
          tables.length === 0 ||
          (
            await pool.query<{ exists: boolean }>(
              `SELECT bool_and(to_regclass('"' || t || '"') IS NOT NULL) AS exists FROM unnest($1::text[]) AS t`,
              [tables]
            )
          ).rows[0]?.exists === true;

        const allTypesExist =
          types.length === 0 ||
          (
            await pool.query<{ exists: boolean }>(
              `SELECT bool_and(to_regtype('"' || t || '"') IS NOT NULL) AS exists FROM unnest($1::text[]) AS t`,
              [types]
            )
          ).rows[0]?.exists === true;

        let allColumnsExist = true;
        for (const { table, column } of addedColumns) {
          const res = await pool.query(
            `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
            [table, column]
          );
          if ((res.rowCount ?? 0) === 0) {
            allColumnsExist = false;
            break;
          }
        }

        if (!allTablesExist || !allTypesExist || !allColumnsExist) break;

        await pool.query(`INSERT INTO "_flowforge_migrations" (name) VALUES ($1) ON CONFLICT DO NOTHING`, [folder]);
        alreadyApplied.add(folder);
        console.log(`[migrate] baselined "${folder}" — everything it creates already exists, marking as applied without re-running`);
      }
    }

    let appliedCount = 0;
    for (const folder of folders) {
      if (alreadyApplied.has(folder)) {
        console.log(`[migrate] skipping "${folder}" — already applied`);
        continue;
      }

      const sqlPath = path.join(MIGRATIONS_DIR, folder, 'migration.sql');
      if (!fs.existsSync(sqlPath)) {
        console.warn(`[migrate] "${folder}" has no migration.sql — skipping`);
        continue;
      }

      const sql = fs.readFileSync(sqlPath, 'utf8');
      console.log(`[migrate] applying "${folder}"...`);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(`INSERT INTO "_flowforge_migrations" (name) VALUES ($1)`, [folder]);
        await client.query('COMMIT');
        console.log(`[migrate] applied "${folder}"`);
        appliedCount++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[migrate] FAILED applying "${folder}":`, err instanceof Error ? err.message : err);
        throw err;
      } finally {
        client.release();
      }
    }

    console.log(`[migrate] done — ${appliedCount} migration(s) applied, ${folders.length - appliedCount} already up to date.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[migrate] migration run failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
