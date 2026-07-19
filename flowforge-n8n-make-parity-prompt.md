# FlowForge — n8n / Make.com Feature Parity: Gap List + Living Implementation Prompt

This document has two parts:

1. **The gap list** — every major n8n/Make.com feature category, FlowForge's current
   status against it, and what's specifically missing.
2. **The living prompt** — paste the block in "How to use this document" into a
   Claude/Claude Code session against this repo. It's designed to be reused turn after
   turn: the AI implements one item, checks it off *in this file*, appends a delivery-log
   section to `README.md` (matching the existing convention — see any `## ... (this
   round)` section), and then stops and asks which item to do next instead of plowing
   through the whole list unsupervised.

Cross-reference: `flowforge-remaining-features-prompt.md` (repo root) covers the same
kind of gap for **integrations specifically** (Teams, Outlook, Drive, Jira, Airtable,
Mailchimp, MongoDB, Kafka, Pinecone, Sentry, PagerDuty, SFTP, social platforms, etc.) in
more detail — that list is folded into section G below by reference rather than
duplicated, so update *that* file's checkboxes when you implement an integration from it.

---

## Part 1 — Gap list

Legend: ✅ have · 🟡 partial/light · ⛔ not started

### A. Triggers

| Feature | n8n / Make.com | FlowForge |
|---|---|---|
| Webhook trigger | ✅ | ✅ |
| Schedule/cron trigger | ✅ | ✅ |
| Manual/test trigger | ✅ | ✅ |
| Email (IMAP) trigger | ✅ | ✅ |
| Database change (CDC) trigger | ✅ | ✅ |
| File watcher trigger | ✅ | ✅ |
| Chat trigger | ✅ | ✅ |
| Streaming trigger (Kafka/etc.) | 🟡 (via generic modules) | ✅ (`streamTrigger` — now actually wired up on activate/publish/boot, see README "Trigger activation wiring (this round)") |
| **Public form trigger** (n8n "Form" node — hosted shareable form URL that starts a run and can pause mid-workflow for more input) | ✅ | 🟡 — trigger form + hosted URL shipped, see README "Triggers: RSS, MQTT, Form, test webhooks (this round)"; mid-workflow pause for a second form page not built |
| **RSS/Atom feed trigger** | ✅ | ✅ — see README "Triggers: RSS, MQTT, Form, test webhooks (this round)" |
| **MQTT trigger** | ✅ | ✅ — see README "Triggers: RSS, MQTT, Form, test webhooks (this round)" |
| **Separate test vs. production webhook URLs** | ✅ (n8n) | ✅ — `POST /webhook/test/:workflowId/:path` added, runs the draft graph without requiring activation; see README |
| Error trigger (dedicated workflow that runs on any failure) | ✅ | ✅ (Error Workflow designation) |

### B. Core control-flow & data nodes

| Feature | n8n / Make.com | FlowForge |
|---|---|---|
| IF / Switch / Router | ✅ | ✅ (`if` now has the visual multi-condition AND/OR builder, `switch`) |
| Merge | ✅ | ✅ |
| Loop / ForEach / Iterator | ✅ | ✅ (`forEach`/`forEachBranch`) |
| Wait / Delay | ✅ | ✅ |
| Code node (JS/Python) | ✅ | ✅ (`isolated-vm` sandboxed JS) |
| Set/Edit Fields | ✅ | ✅ |
| **Filter node** (drop items not matching a condition, distinct from IF's branching) | ✅ | ✅ — see README "Filter node (this round)" |
| **Split Out** (array field → one item per element) | ✅ | ✅ — see README "Item-array utility nodes (this round)" |
| **Aggregate** (many items → one item, e.g. collect into an array/object) | ✅ | ✅ — see README "Item-array utility nodes (this round)" |
| **Sort** | ✅ | ✅ — see README "Item-array utility nodes (this round)" |
| **Limit** (cap item count) | ✅ | ✅ — see README "Item-array utility nodes (this round)" |
| **Remove Duplicates** | ✅ | ✅ — see README "Item-array utility nodes (this round)" |
| **Compare Datasets** (diff two item lists) | ✅ | ✅ — see README "Compare Datasets node (this round)" |
| **Stop and Error** (deliberately fail with a custom message) | ✅ | ✅ — see README "Item-array utility nodes (this round)" |
| Sub-workflow call | ✅ | ✅ (`subWorkflow`) |
| **Execute-Workflow trigger** (typed entry point for a workflow meant to be called as a sub-workflow, with declared input schema) | ✅ | ✅ — see README "Execute-Workflow trigger + NoOp (this round)" |
| Sticky notes / canvas annotations | ✅ | ✅ |
| NoOp / pass-through node | ✅ | ✅ — see README "Execute-Workflow trigger + NoOp (this round)" |

### C. Data-transformation utility nodes

| Feature | n8n / Make.com | FlowForge |
|---|---|---|
| Item Lists (chunk, flatten, dedupe helpers) | ✅ | ✅ — see README "Item Lists node (this round)" |
| Date & Time (parse/format/math) | ✅ | ✅ — see README "Data-transformation utility nodes: Date & Time, HTML Extract, Markdown⇄HTML, XML⇄JSON, Crypto, Compression, Text parser (this round)" |
| HTML Extract (CSS-selector scraping) | ✅ | ✅ — see README "Data-transformation utility nodes... (this round)" |
| Markdown ⇄ HTML | ✅ | ✅ — see README "Data-transformation utility nodes... (this round)" |
| XML ⇄ JSON | ✅ | ✅ — see README "Data-transformation utility nodes... (this round)" |
| Crypto (hash/HMAC/sign) | ✅ | ✅ — see README "Data-transformation utility nodes... (this round)" |
| Compression (zip/unzip/gzip) | ✅ | ✅ — see README "Data-transformation utility nodes... (this round)" |
| Extract/Convert file (PDF, CSV, image) | ✅ | ✅ (file convert/extract already built) |
| Text parser / regex module (Make) | ✅ | ✅ — see README "Data-transformation utility nodes... (this round)" |

### D. AI / agents

| Feature | n8n / Make.com | FlowForge |
|---|---|---|
| AI Agent node (tool use, ReAct-style) | ✅ | ✅ |
| Agent memory (short/long-term) | ✅ | ✅ (JSON store — not yet on the pluggable vector layer RAG uses) |
| Multi-agent orchestration | 🟡 | ✅ |
| RAG (chunking, hybrid search, reranking, pluggable vector DB) | ✅ | ✅ |
| OpenAI / Anthropic / Gemini nodes | ✅ | ✅ |
| **Local/self-hosted model support (Ollama, vLLM, etc.)** | ✅ | ✅ — see README "Local LLM node: Ollama / vLLM support (this round)" |
| **Groq / Mistral / other hosted providers** | ✅ | ✅ — see README "Groq + Mistral provider nodes (this round)" |
| **Dedicated micro-nodes**: Text Classifier, Sentiment Analysis, Information/Entity Extractor, Summarization chain, Q&A chain | ✅ (n8n LangChain nodes) | ✅ — see README "AI micro-nodes: Classifier, Sentiment, Extractor, Summarizer, Q&A Chain (this round)" |
| **Natural-language-to-workflow generator** ("AI Workflow Builder" — describe a workflow in plain English, get a draft graph) | ✅ (n8n 2.0) | ✅ — already fully implemented (not this round's new work): `POST /ai/generate-workflow` in `apps/api/src/routes/ai.ts` (curated node catalog + system prompt + OpenAI call) plus a complete "✨ Generate with AI" modal/button + command-palette entry in `apps/web/src/pages/CanvasPage.tsx` that replaces the canvas with the generated graph. Found already-built while starting this item — see README "Section D closeout note (this round)".
| Human-in-the-loop approval | ✅ | ✅ (`humanApproval`) |

### E. Execution engine & debugging

| Feature | n8n / Make.com | FlowForge |
|---|---|---|
| Item-paired data model (json + binary + lineage) | ✅ | ✅ |
| Per-node retry policy + `continueOnFail` | ✅ | ✅ |
| Pause/resume (`waitForWebhook`/human approval) | ✅ | ✅ |
| Live execution view (active node highlight, animated edges) | ✅ | ✅ |
| Per-node input/output inspector (Table/JSON/Schema) | ✅ | ✅ |
| Execution history + replay-from-node | ✅ | ✅ |
| **Cancel a running/paused execution from the canvas** | ✅ | ✅ *(shipped this round — see README "Cancel-from-canvas")* |
| **Step-through / pause-at-breakpoint debug mode** | ✅ (n8n "Partial Execution"/pin+step) | ⛔ |
| **"Use this node's output as test input"** (grab a past run's output and feed it in as the new manual-trigger payload) | ✅ | ⛔ |
| **Diff view** between two executions, or between draft/published workflow versions' *data*, not just graph structure | 🟡 — workflow-version diff exists; execution-to-execution data diff doesn't | ⛔ |
| **Inline expression preview** (live-evaluated `{{ }}` value shown next to the field as you type, instead of only at run time) | ✅ | ⛔ |
| **Live per-item ticking during a batch** (progress indicator mid-loop, e.g. "item 47 of 200", rather than only a final per-node summary) | ✅ | ⛔ |
| Expression editor with function autocomplete + docs | ✅ | ⛔ — expressions work, no rich editor |

### F. Workflow lifecycle & collaboration

| Feature | n8n / Make.com | FlowForge |
|---|---|---|
| Draft/publish/rollback/diff versioning | ✅ | ✅ |
| Workspaces, folders, roles, comments, activity log, alerts | ✅ | ✅ |
| Real-time viewer presence (avatars, live cursors) | ✅ | ✅ |
| **True multi-user concurrent editing** (two people dragging/editing nodes on the same canvas at once, conflict-resolved — n8n/Make both support this) | ✅ | ⛔ — presence/cursors exist, actual concurrent node editing doesn't |
| Templates gallery | ✅ | ✅ |
| **Git-based source control sync** (n8n Enterprise: push/pull workflows as versioned files to a git repo) | ✅ | ⛔ |
| **Environments / promote draft → staging → production across separate deployments** | ✅ | ⛔ — single-environment draft/publish only |
| **Import from Zapier/Make/n8n** workflow JSON | 🟡 (n8n imports its own format; some community converters exist) | ⛔ |
| **Export to LangGraph/CrewAI/Docker/standalone Python** | ⛔ (neither platform does this well either) | ⛔ — parity isn't really expected here, listed for completeness only |

### G. Integrations catalog

Covered in full by `flowforge-remaining-features-prompt.md` — Microsoft Teams/Outlook,
Google Drive, Dropbox, Zoom, Calendly, Trello/Asana/ClickUp/Linear, Jira, Airtable,
DocuSign, PayPal, QuickBooks/Xero, Zendesk, Mailchimp/SendGrid, Segment, Google/Meta Ads,
Amplitude/Mixpanel, MongoDB, MySQL, Kafka, Elasticsearch/OpenSearch, Pinecone/Weaviate/
Qdrant, Sentry, PagerDuty/Opsgenie, Datadog, generic SFTP/FTP, LinkedIn/X/Facebook/
Instagram/YouTube. n8n ships 400+, Make effectively unlimited via its generic
HTTP/OAuth app framework — FlowForge covers ~30 today (see README's built-in node
catalog). Don't re-list these here; check that file's boxes instead.

### H. Platform / enterprise

| Feature | n8n / Make.com | FlowForge |
|---|---|---|
| Workspace billing/usage metering | ✅ | ✅ (Stripe, mock-mode fallback) |
| Community node marketplace | ✅ | ✅ (real npm install/uninstall/hot-reload) |
| **Custom-node authoring SDK/CLI** (scaffold + local dev/hot-reload loop for *writing* a new node, as opposed to installing one) | ✅ | ⛔ |
| **SSO/SAML/OIDC** | ✅ | ⛔ — `FEATURE_SSO_ENABLED` variable + settings UI exist but aren't wired to a real auth flow (confirm before starting — see item B in the integrations prompt) |
| **RBAC granular permissions** (beyond workspace owner/member roles) | ✅ | ⛔ — `RbacPage.tsx` UI exists, unclear if enforced server-side |
| **Full audit log coverage** (every sensitive mutation, not just workflow edits) | ✅ | 🟡 — confirm coverage per the integrations prompt's item B |
| **Rate limiting on public endpoints** (`/webhook`, `/auth`) | ✅ | 🟡 — `RATE_LIMIT_PER_MINUTE` seeded as a Variable; confirm it's enforced |
| **Execution retention cron enforcement** | ✅ | 🟡 — `EXECUTION_RETENTION_DAYS` seeded; confirm a sweeper actually runs (README mentions `startRetentionSweeper` exists — verify it's wired to the variable, not a fixed constant) |
| **Published/public API** with its own API-key auth (distinct from user JWT sessions) for external systems to trigger/manage workflows | ✅ | ⛔ — current API is session-auth only |
| Mobile-responsive canvas (not just list pages) | ✅ | 🟡 — `useIsMobile` used elsewhere; confirm the node editor itself, not just list pages |
| Multi-region / horizontal worker scaling | ✅ | 🟡 — BullMQ concurrency exists; no documented multi-region story |

---

## Part 2 — How to use this document

Copy the block below verbatim into a new Claude/Claude Code session, with this repo
(and this file) available. It's written so the loop is self-sustaining: implement →
check off → log → ask → repeat, one item per turn, forever, until you tell it to stop or
the list is empty.

````text
You're picking up work on the FlowForge repo (an n8n/Make.com-style workflow
automation platform). Read `flowforge-n8n-make-parity-prompt.md` at the repo root —
it's a checklist of every feature gap against n8n/Make.com, grouped into sections
A-H. Also skim `README.md`'s existing `## ... (this round)` sections so you follow
the established conventions (node = new file in apps/worker/src/nodes/ registered
via NODE_REGISTRY; Zod-validated Express routes; shared types in
packages/shared-types; credentials via credentialId, never inlined; mock-mode
pattern for anything needing paid API keys, see apps/api/src/routes/billing.ts).

Your loop, every turn:

1. Find the first unchecked (⛔ or 🟡) row in the gap list that hasn't already been
   assigned to you this session. If more than one reasonable candidate exists, or
   the item requires a product decision (e.g. which OAuth provider, which vector DB
   default), ask me which to do before writing code — don't guess silently on
   anything that changes user-facing behavior.
2. State which files you're adding/touching before writing code.
3. Implement it following the existing patterns exactly. Don't refactor unrelated
   code while you're in there.
4. Run `tsc --noEmit` on every touched workspace (`apps/api`, `apps/worker`,
   `apps/web`, `packages/shared-types`) — if `pnpm install` is needed and the bare
   `"@flowforge/shared-types": "*"` specifier fails to resolve, use
   `"workspace:*"` instead (this repo's install occasionally needs that). Before
   reporting anything as a new error, diff it against a pristine copy of the repo to
   confirm you didn't just surface a pre-existing issue — call out the difference
   explicitly either way.
5. Update THIS file: flip the row's status from ⛔/🟡 to ✅, and if the row was a
   table cell rather than a bolded gap line, add a one-line note next to it pointing
   at the README section that documents it (e.g. "— see README 'Cancel-from-canvas
   (this round)'").
6. Append a new `## <Feature name> (this round)` section to `README.md`, matching
   the exact structure every prior round used: "What changed" (bullet per file,
   explain the *why* not just the *what*), "Not done in this pass" (be honest about
   corners cut), "Verified" (what you actually ran, and what you didn't).
7. Stop. Don't start the next item automatically. Tell me:
   - what you just shipped, in 2-3 sentences
   - the exact checklist row(s) you flipped to ✅
   - a short list (3-6) of the next reasonable candidates from the unchecked rows,
     so I can pick — including calling out if the next natural item is a big one
     (e.g. "step-through debug mode touches the execution engine's core loop,
     bigger than the last few") so I can size my choice correctly.

Rules that apply every turn, not just once:

- One item per turn. If I say "keep going" I mean "do the next one and stop again,"
  not "do the rest of the list unsupervised."
- Never mark a row ✅ based on code you didn't actually write and verify this
  session — if you're inferring something might already exist, say "possibly
  already covered — please confirm" instead of silently checking the box.
- If an item turns out to already be implemented (common in this repo — several
  "not started" items in old prompts turned out to be partially built), say so,
  correct the row to ✅ or 🟡 with a note of what's actually there, and ask what
  to do next rather than treating that as your turn's deliverable.
- Prefer editing/extending an existing node or route over creating a parallel one
  when a close cousin already exists (e.g. Filter is a close cousin of `if` — check
  whether `if` can be trivially adapted before writing a whole new plugin).
- Export the full repo as a zip on request, but don't do it unprompted every turn —
  ask, or wait until I ask, since re-zipping a ~1MB repo on every single small change
  is noisy.
````

When the whole list is exhausted, don't stop entirely — re-run a real feature audit
(actual n8n/Make.com changelogs may have moved since this document was written) and
propose new rows before declaring FlowForge "done."
