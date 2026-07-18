// FlowForge browser-runner
// A tiny, real HTTP wrapper around Playwright/Chromium so the worker's
// `browserAutomation` node can drive an actual browser without embedding
// one in the job queue process. Also serves screenshots as static files
// so the FlowForge UI can show them (in an <img>/<iframe>) as a "live
// execution view".
//
// Run standalone:  npm install && npx playwright install --with-deps chromium && npm start
// Run via Docker:  docker compose --profile browser up -d browser-runner

import express from 'express';
import { chromium } from 'playwright';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT || 7900;
const API_KEY = process.env.BROWSER_RUNNER_API_KEY || '';
const SHOTS_DIR = process.env.SHOTS_DIR || '/tmp/flowforge-shots';
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use('/shots', express.static(SHOTS_DIR));

app.use((req, res, next) => {
  if (!API_KEY) return next();
  const auth = req.headers.authorization;
  if (auth === `Bearer ${API_KEY}`) return next();
  res.status(401).json({ error: 'unauthorized' });
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

/**
 * POST /run
 * body: { url: string, steps: Step[], fullPageScreenshot?: boolean }
 * Step = { action: 'goto'|'click'|'type'|'waitFor'|'screenshot'|'extractText', selector?: string, value?: string, timeoutMs?: number }
 */
app.post('/run', async (req, res) => {
  const { url, steps = [], fullPageScreenshot = false } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });

  const browser = await chromium.launch({ headless: true });
  const log = [];
  let extracted = null;
  let screenshotUrl = null;

  try {
    const page = await browser.newPage();
    log.push(`goto ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    for (const step of steps) {
      const timeout = step.timeoutMs ?? 10000;
      switch (step.action) {
        case 'goto':
          await page.goto(step.value, { timeout });
          log.push(`goto ${step.value}`);
          break;
        case 'click':
          await page.click(step.selector, { timeout });
          log.push(`click ${step.selector}`);
          break;
        case 'type':
          await page.fill(step.selector, step.value ?? '', { timeout });
          log.push(`type into ${step.selector}`);
          break;
        case 'waitFor':
          await page.waitForSelector(step.selector, { timeout });
          log.push(`waitFor ${step.selector}`);
          break;
        case 'extractText': {
          const text = await page.locator(step.selector).allInnerTexts();
          extracted = text;
          log.push(`extractText ${step.selector} -> ${text.length} match(es)`);
          break;
        }
        case 'screenshot': {
          const file = `${randomUUID()}.png`;
          await page.screenshot({ path: path.join(SHOTS_DIR, file), fullPage: fullPageScreenshot });
          screenshotUrl = `/shots/${file}`;
          log.push(`screenshot -> ${screenshotUrl}`);
          break;
        }
        default:
          log.push(`skipped unknown action: ${step.action}`);
      }
    }

    // Always take a final screenshot so the UI has something to show even
    // if the workflow author didn't add an explicit screenshot step.
    if (!screenshotUrl) {
      const file = `${randomUUID()}.png`;
      await page.screenshot({ path: path.join(SHOTS_DIR, file), fullPage: fullPageScreenshot });
      screenshotUrl = `/shots/${file}`;
    }

    const html = await page.content();
    res.json({
      screenshotUrl: `${req.protocol}://${req.get('host')}${screenshotUrl}`,
      html: html.slice(0, 20000), // cap payload size
      extracted,
      log,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, log });
  } finally {
    await browser.close();
  }
});

app.listen(PORT, () => console.log(`browser-runner listening on :${PORT}`));
