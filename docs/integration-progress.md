# Integration & Platform Feature Progress

Tracks status against `flowforge-remaining-features-prompt.md`. Update this
file whenever an item's status changes — it's the source of truth for what's
actually done vs. still open, since the original prompt doc is a static wishlist.

Last updated: this session (finance/marketing/productivity/dev-infra/social
integration batch).

---

## A. Integrations

### Productivity / collaboration
| Item | Status | Notes |
|---|---|---|
| Microsoft Teams | ✅ Done (prior session) | `productivityIntegrations.ts` |
| Microsoft Outlook / Office 365 | ✅ Done (prior session) | `productivityIntegrations.ts` |
| Google Drive | ✅ Done (prior session) | `productivityIntegrations.ts` |
| Dropbox | ✅ Done (prior session) | `productivityIntegrations.ts` |
| Zoom | ✅ Done (prior session) | `productivityIntegrations.ts` |
| Calendly | ✅ Done (this session) | `schedulingIntegrations.ts` — action-side node (list/get invitee/cancel). Booking trigger reuses the generic `webhook` trigger node + signature verification in workflow logic, not a dedicated trigger type — see file header comment. |
| Trello / Asana / ClickUp / Linear | ✅ Done (prior session) | `pmIntegrations.ts` |
| Jira | ✅ Done (prior session) | `pmIntegrations.ts` |
| Airtable | ✅ Done (this session) | `airtableNode.ts` — real core node: list/get/create/update/upsert/delete via the Airtable Web API. Was previously only an illustrative marketplace/npm entry (removed from `registryIndex.ts`). |
| DocuSign | ✅ Done (this session) | `schedulingIntegrations.ts` — send envelope + status check. Completion webhook: point DocuSign Connect at the generic `webhook` trigger, same pattern as Calendly. |

### Finance / commerce
| Item | Status | Notes |
|---|---|---|
| PayPal | ✅ Done (this session) | `financeIntegrations.ts` — client-credentials OAuth2, order create/capture/get, payouts. |
| QuickBooks | ✅ Done (this session) | `financeIntegrations.ts` — invoice CRUD-lite, customers, company info. |
| Xero | ✅ Done (this session) | `financeIntegrations.ts` — invoices, contacts. |
| Zendesk | ✅ Done (this session) | `financeIntegrations.ts` — was previously only an illustrative marketplace npm entry; that entry was removed from `registryIndex.ts` since this is now a real core node. |

### Marketing / growth
| Item | Status | Notes |
|---|---|---|
| Mailchimp | ✅ Done (this session) | `marketingIntegrations.ts` — was previously only an illustrative marketplace npm entry; removed from `registryIndex.ts`. |
| SendGrid | ✅ Done (this session) | `marketingIntegrations.ts` — transactional send via API. |
| Segment | ✅ Done (this session) | `marketingIntegrations.ts` — track/identify/page/group. |
| Google Ads | ✅ Done (this session) | `marketingIntegrations.ts` — GAQL search/read only, per "campaign metrics pull" scope; no campaign-write actions. |
| Meta Ads | ✅ Done (this session) | `marketingIntegrations.ts` — insights/read only, same scope as above. |
| Amplitude | ✅ Done (this session) | `marketingIntegrations.ts` — HTTP V2 event ingest. |
| Mixpanel | ✅ Done (this session) | `marketingIntegrations.ts` — event track. |

### Dev / infra
| Item | Status | Notes |
|---|---|---|
| MongoDB | ✅ Done (prior session) | `devInfraIntegrations.ts` |
| MySQL | ✅ Done (prior session) | `devInfraIntegrations.ts` |
| Kafka producer/consumer | ✅ Done (prior session) | `apps/api/src/utils/triggerPollers.ts` (trigger/consumer side); confirmed `kafkajs` is actually wired, not just an unused dependency. |
| Elasticsearch / OpenSearch | ✅ Done (this session) | Appended to `devInfraIntegrations.ts` — plain REST calls (both speak the same wire protocol for search/index/delete), no separate client library needed. |
| Pinecone / Weaviate / Qdrant | ✅ Done (prior session) | `apps/worker/src/nodes/rag/stores/` — confirmed pluggable vector-store backends already exist. |
| Sentry | ✅ Done (prior session) | `devInfraIntegrations.ts` |
| PagerDuty | ✅ Done (prior session) | `devInfraIntegrations.ts` |
| Opsgenie | ⬜ Not done | Not addressed this session. |
| Datadog | ✅ Done (prior session) | `devInfraIntegrations.ts` |
| Generic SFTP/FTP | ✅ Done (this session) | Appended to `devInfraIntegrations.ts` — `protocol` param picks `sftp` (ssh2-sftp-client, buffer upload/download) or `ftp` (basic-ftp, list/delete only — no in-memory buffer transfer in that library without a local file path). Both drivers lazily imported like mongodb/mysql; **new deps `ssh2-sftp-client` and `basic-ftp` added to `apps/worker/package.json` — run `pnpm install` before using this node.** |

### Social
| Item | Status | Notes |
|---|---|---|
| LinkedIn | ✅ Done (this session) | `socialIntegrations.ts` — UGC post create + profile read. |
| X / Twitter | ✅ Done (this session) | `socialIntegrations.ts` — tweet create + user read via API v2. Posting requires a user-context OAuth2 token (tweet.write scope); app-only bearer tokens can't post — documented in the credential help text. |
| Facebook | ✅ Done (this session) | `socialIntegrations.ts` — Page post create/list via Graph API. |
| Instagram | ✅ Done (this session) | `socialIntegrations.ts` — two-step container-create-then-publish flow (Meta's actual API shape), rides on a connected Facebook Page token. |
| YouTube | ✅ Done (this session) | `socialIntegrations.ts` — list/update video metadata via Data API v3. |

---

## B. Platform features (non-node) — status still unconfirmed

None of these were addressed this session (integrations were prioritized first,
per your instruction). Still open, in the state described by the original
prompt doc:

- **SSO** — `SsoSettingsPage.tsx` / `RbacPage.tsx` exist; not yet confirmed whether SAML/OIDC is actually wired to an auth provider or still UI-only.
- **Audit log completeness** — not yet confirmed every sensitive mutation (credential create/delete, billing plan change, workspace role change, community node install) writes an `ActivityLog` row.
- **Notification channel delivery** — not yet confirmed alerts actually reach Slack/email/webhook vs. just an in-app list.
- **Rate limiting enforcement** — not yet confirmed `RATE_LIMIT_PER_MINUTE` is enforced on `/webhook`, `/webhook-resume`, `/auth`, vs. just documented.
- **Retention cron** — not yet confirmed a job honors `EXECUTION_RETENTION_DAYS`.
- **Mobile-responsive canvas** — not yet confirmed the node editor itself (not just list pages) works at the `useIsMobile` breakpoint.
- **Real-time multi-user canvas collaboration** — not yet confirmed whether this exists beyond comments/versioning.

---

## Known gaps / follow-ups from this session

- **New worker deps not installed**: `ssh2-sftp-client` and `basic-ftp` were added to `apps/worker/package.json` but this sandbox has no network access to `pnpm install` them or run a real build. Run `pnpm install` at the repo root, then `pnpm -F api exec tsc --noEmit` and `pnpm -F web exec tsc --noEmit` before treating this batch as fully verified — that was requested in the original prompt's process section and wasn't yet possible here.
- **Opsgenie** is the one item from the original list still not implemented at all. (Airtable was completed in a later session — see its row above.)
- **Google Ads / Meta Ads** are read-only (metrics pull), matching the prompt's stated scope — no campaign-write actions were built.
- The stale `flowforge-node-zendesk` / `flowforge-node-mailchimp` curated marketplace entries were removed from `apps/api/src/marketplace/registryIndex.ts` since both are now real core nodes. Note the repo still has a handful of *other* pre-existing core node types (linear, jira, dropbox, stripe, asana, trello, clickup) that are simultaneously registered as built-in nodes **and** listed as curated npm marketplace entries — that inconsistency predates this session and wasn't in scope to fix, but is worth cleaning up in a future pass.
