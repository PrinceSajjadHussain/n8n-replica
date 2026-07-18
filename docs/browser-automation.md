# Browser Automation node — setup guide

The `browserAutomation` node drives a **real** headless Chrome browser
(via Playwright) so a workflow can click buttons, fill forms, and scrape
pages that a plain `httpRequest` call can't (JS-rendered sites, logins,
multi-step flows). It talks to a small companion HTTP service —
`services/browser-runner` — instead of launching Chrome inside the queue
worker itself (embedding a browser in a job worker is heavy and fragile
under load).

## 1. Start the browser-runner service

**With Docker (recommended):**
```bash
docker compose --profile browser up -d browser-runner
```
This builds `services/browser-runner` on top of the official
`mcr.microsoft.com/playwright` image (Chromium already installed) and
exposes it on `http://localhost:7900`.

**Without Docker:**
```bash
cd services/browser-runner
npm install
npx playwright install --with-deps chromium
npm start
```

## 2. (Optional) protect it with an API key

Set `BROWSER_RUNNER_API_KEY` in your root `.env` before starting the
container — the service will require `Authorization: Bearer <key>` on
every request, and the worker automatically sends it if you configure a
`browserRunner` credential (see step 3) or set the same env var on the
worker.

## 3. Point the worker at it

In `.env`:
```
BROWSER_RUNNER_URL="http://localhost:7900"   # or http://browser-runner:7900 in docker-compose
BROWSER_RUNNER_API_KEY=""                     # optional
```
Or, per-workflow, create a credential in the Credentials page:
```json
{ "type": "browserRunner", "data": { "baseUrl": "http://localhost:7900", "apiKey": "" } }
```
and attach it to the `browserAutomation` node.

## 4. Configure the node

Params (JSON) on the node:
```json
{
  "url": "https://example.com/login",
  "steps": [
    { "action": "type", "selector": "#email", "value": "you@example.com" },
    { "action": "type", "selector": "#password", "value": "{{credential.password}}" },
    { "action": "click", "selector": "#submit" },
    { "action": "waitFor", "selector": ".dashboard" },
    { "action": "extractText", "selector": ".account-balance" },
    { "action": "screenshot" }
  ],
  "fullPageScreenshot": true
}
```

Supported `action` values: `goto`, `click`, `type`, `waitFor`,
`extractText`, `screenshot`.

## 5. What you get back

The node's output looks like:
```json
{
  "screenshotUrl": "http://localhost:7900/shots/<uuid>.png",
  "html": "<first 20k chars of the final page HTML>",
  "extracted": ["...text pulled via extractText steps..."],
  "log": ["goto https://...", "click #submit", "..."]
}
```

`screenshotUrl` is a plain static file URL — the FlowForge UI can render
it directly with `<img src={screenshotUrl} />` (or wrap it in an
`<iframe src={screenshotUrl}>` if you'd rather embed it as a document).
There is currently no live/streaming iframe of the browser itself — that
would require a VNC/CDP streaming bridge (e.g. `selenium/standalone-chrome`
with noVNC, or `browserless.io`) fronted by an iframe; the screenshot
approach here is the lightweight, dependency-free alternative and is
enough for most scrape/verify workflows. If you need true live viewing,
swap the `browser-runner` image for `selenium/standalone-chrome-debug`
(exposes noVNC on :7900) and iframe that URL directly in the UI.

## Troubleshooting

- **"Could not reach the browser-runner service"** → it isn't running, or
  `BROWSER_RUNNER_URL` is wrong. Check `docker compose ps` / `curl
  http://localhost:7900/health`.
- **Selectors not found** → the page may render client-side after the
  initial `domcontentloaded` event; add a `waitFor` step before
  interacting with dynamic elements.
- **Timeouts on slow pages** → pass `"timeoutMs": 30000` on the specific
  step.
