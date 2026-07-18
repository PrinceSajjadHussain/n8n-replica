import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

function tryLoad(p: string) {
  try {
    if (fs.existsSync(p)) {
      const res = dotenv.config({ path: p });
      if (!('error' in res) || !res.error) {
        console.log(`[env] loaded ${p}`);
        return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

// 1) Respect explicit override first
const explicit = process.env.DOTENV_CONFIG_PATH;
if (!(explicit && tryLoad(explicit))) {
  // 2) Try CWD .env (running from repo root)
  const cwdEnv = path.resolve(process.cwd(), '.env');
  if (!tryLoad(cwdEnv)) {
    // 3) Try parent of CWD (running from apps/api)
    const parentEnv = path.resolve(process.cwd(), '../.env');
    if (!tryLoad(parentEnv)) {
      // 4) Try resolving from source/dist directory to repo root
      //    - src:   apps/api/src       → ../../../.env
      //    - dist:  apps/api/dist      → ../../../.env
      const upThree = path.resolve(__dirname, '../../../.env');
      if (!tryLoad(upThree)) {
        // 5) As a last resort, try two-up (older layout variants)
        const upTwo = path.resolve(__dirname, '../../.env');
        tryLoad(upTwo);
      }
    }
  }
}

// Development-friendly defaults if still unset and known dev ports are used
if (!process.env.REDIS_URL) {
  process.env.REDIS_URL = 'redis://localhost:6380';
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5433/flowforge?schema=public';
}

