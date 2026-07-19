# FlowForge — Remaining Integrations & Features Prompt

Use this prompt as-is (or trim sections) in a future Claude/Claude Code session working on the FlowForge repo. It assumes the existing conventions: node plugins registered via side-effect import in `apps/worker/src/nodes/index.ts`, Zod-validated Express routes in `apps/api/src/routes/`, shared types in `packages/shared-types`, credentials referenced by `credentialId` (never inlined), and the mock-mode pattern used by Stripe billing (real integration when env vars are set, safe mock fallback otherwise).

---

## Context: what's already built

Confirm by reading `apps/worker/src/nodes/*.ts` before starting — don't re-implement:
Slack, Discord, Telegram, WhatsApp, Twilio, Gmail, Google Calendar, Google Sheets, Notion, GitHub, HubSpot, Salesforce, Shopify, Stripe, AWS S3, Postgres, OpenAI, Anthropic, Gemini, RAG (ingest/query), browser automation, AI agent + agent memory/orchestrator, Redis memory, email (IMAP), file convert/extract, Data Tables, HTTP request, and core control-flow nodes (If/Switch/Merge/ForEach/Wait/Code/Set).

Triggers already supported: webhook, schedule, chatTrigger, emailTrigger, fileWatcher, databaseChange, streamTrigger, manual/test.

---

## Task

Implement the missing integrations and platform features below, following the existing code patterns exactly:

1. New node = new file in `apps/worker/src/nodes/`, registered via `NODE_REGISTRY`, imported (side-effect) in `apps/worker/src/nodes/index.ts`.
2. Auth goes through the `Credential` model + `credentialId`, never hardcoded keys.
3. Every external-API node needs a documented failure mode (timeout, 401, rate limit) and should return a structured error item rather than throwing where FlowForge's existing nodes do the same.
4. Update `packages/shared-types/src/index.ts`'s `NodeType` union and any node-picker UI list in `apps/web/src`.
5. Add each new node to the curated marketplace index or core registry as appropriate — don't silently add undocumented nodes.

### A. Missing integrations (pick based on priority)

**Productivity / collaboration**
- Microsoft Teams (messages, channel post)
- Microsoft Outlook / Office 365 (mail + calendar, parallel to the existing Gmail/Google Calendar nodes)
- Google Drive (upload/download/list, separate from Sheets)
- Dropbox
- Zoom (create meeting, list recordings)
- Calendly (booking webhook trigger)
- Trello / Asana / ClickUp / Linear (the repo has GitHub issues but no generic project-management board)
- Jira (mentioned in `Variables` defaults as a base URL but has no actual node)
- Airtable (same — seeded as a Variable/marketplace example, not implemented as a real node)
- DocuSign (send for signature, webhook on completion)

**Finance / commerce**
- PayPal (as an alternative to Stripe)
- QuickBooks / Xero (invoicing, accounting sync)
- Zendesk (mentioned in marketplace catalog and Variables as an example — needs an actual implementation, not just an illustrative npm name)

**Marketing / growth**
- Mailchimp / SendGrid (base URL is already seeded as a default Variable, no node yet)
- Segment (event tracking)
- Google Ads / Meta Ads (campaign metrics pull)
- Amplitude / Mixpanel

**Dev / infra**
- MongoDB (Postgres exists; add a NoSQL option)
- MySQL / generic SQL via connection string
- Kafka producer/consumer (the `kafkajs` dependency is already in `package.json` but unused — check if any node actually calls it)
- Elasticsearch / OpenSearch
- Pinecone / Weaviate / Qdrant (dedicated vector-store nodes — RAG nodes currently exist but check what vector backend they call today, and whether it's pluggable)
- Sentry (error ingestion trigger, issue creation)
- PagerDuty / Opsgenie (incident creation from workflow alerts)
- Datadog (metrics/log push)
- Generic SFTP/FTP node

**Social**
- LinkedIn, X/Twitter, Facebook/Instagram, YouTube (content posting / basic read)

### B. Missing platform features (non-node)

- **SSO**: `FEATURE_SSO_ENABLED` exists as a seeded Variable and there's an `SsoSettingsPage.tsx`/`RbacPage.tsx` — check whether SAML/OIDC is actually wired to an auth provider or is UI-only, and implement the real auth flow if it's a stub.
- **Audit log completeness**: confirm every sensitive mutation (credential create/delete, billing plan change, workspace member role change, community node install) writes an `ActivityLog`/audit row, not just workflow edits.
- **Notification channels for workflow alerts**: `workflowActivityRouter`/alerts exist — confirm delivery actually reaches Slack/email/webhook, not just an in-app list.
- **Rate limiting on public endpoints** (`/webhook`, `/webhook-resume`, `/auth`) — check whether `RATE_LIMIT_PER_MINUTE` (seeded Variable) is enforced anywhere or just documented.
- **Multi-region / retention enforcement**: `EXECUTION_RETENTION_DAYS` is seeded as a Variable — confirm there's an actual cron/cleanup job honoring it.
- **Mobile-responsive canvas**: confirm the workflow canvas (node editor) itself, not just list pages, works on the mobile breakpoint already used elsewhere (`useIsMobile`).
- **Real-time collaboration** on the canvas (multiple users editing one workflow) — check if this exists or if only comments/versioning do.

### C. Process

For each item you implement:
1. State which files you're adding/touching before writing code.
2. Reuse the mock-mode pattern (see `apps/api/src/routes/billing.ts`) for anything needing paid API credentials, so the feature is testable without live keys.
3. Run `tsc --noEmit` on both `apps/api` and `apps/web` before considering it done.
4. Don't implement everything in one pass — confirm priority order with me first if the list is large.

---

## How I'll prioritize (fill in before sending)

- [ ] Must-have integrations: _______________
- [ ] Nice-to-have integrations: _______________
- [ ] Platform features to check/fix first: _______________
- [ ] Anything explicitly out of scope for now: _______________
