import axios from 'axios';
import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * browserAutomation — drives a real Chrome instance for scraping / form
 * filling / clicking, via a small companion "browser-runner" HTTP service
 * (Selenium Grid or Playwright). We do NOT launch Chrome inside this worker
 * process — headless Chrome inside a queue worker is fragile and heavy.
 * Instead this node POSTs a script of steps to BROWSER_RUNNER_URL and
 * returns the result (including a screenshot URL you can display, e.g. in
 * an <iframe>/<img> in the FlowForge UI).
 *
 * See /docs/browser-automation.md in this repo for how to stand up the
 * companion service with docker-compose (selenium/standalone-chrome or a
 * tiny Playwright Express wrapper).
 *
 * credential (type 'browserRunner'): { baseUrl?: string, apiKey?: string }
 * params:
 *   url: string                 page to open
 *   steps?: Array<Step>         see docs/browser-automation.md for the Step shape
 *     { action: 'click'|'type'|'waitFor'|'screenshot'|'extractText'|'goto', selector?: string, value?: string, timeoutMs?: number }
 *   fullPageScreenshot?: boolean
 */
export const browserAutomationNode: NodePlugin = {
  type: 'browserAutomation',
  async execute({ params, credential }) {
    const baseUrl =
      (credential?.baseUrl as string) ?? process.env.BROWSER_RUNNER_URL ?? 'http://localhost:7900';
    const apiKey = (credential?.apiKey as string) ?? process.env.BROWSER_RUNNER_API_KEY;
    const url = String(params.url ?? '');
    if (!url) throw new Error('browserAutomation node: "url" param is required');

    try {
      const response = await axios.post(
        `${baseUrl}/run`,
        {
          url,
          steps: params.steps ?? [],
          fullPageScreenshot: Boolean(params.fullPageScreenshot),
        },
        {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          timeout: 90000,
        }
      );
      // Expected shape from the runner: { screenshotUrl, html, extracted, log }
      return { output: response.data };
    } catch (err) {
      const message = axios.isAxiosError(err) && err.code === 'ECONNREFUSED'
        ? `Could not reach the browser-runner service at ${baseUrl}. Start it first — see docs/browser-automation.md ("docker compose --profile browser up -d").`
        : `browserAutomation call failed: ${(err as Error).message}`;
      throw new Error(message);
    }
  },
};

registerNode(browserAutomationNode);
