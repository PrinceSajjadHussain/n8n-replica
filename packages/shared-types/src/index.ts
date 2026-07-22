// Shared types used across api, worker, and web

// ---------------------------------------------------------------------------
// Binary data & item-pairing model
// ---------------------------------------------------------------------------

/**
 * A single piece of binary/file data (image, PDF, attachment, etc.) attached
 * to an item. Content is carried as base64 in `data` — fine for the sizes
 * FlowForge workflows deal with (attachments, API responses, generated
 * files); a node can swap in a `directRef` (id into an external object
 * store) instead of `data` for very large payloads without changing the
 * shape callers see.
 */
export interface BinaryData {
  /** e.g. "image/png", "application/pdf" */
  mimeType: string;
  fileName?: string;
  fileExtension?: string;
  /** byte length of the decoded content */
  fileSize?: number;
  /** base64-encoded file content. Mutually exclusive with `directRef`. */
  data?: string;
  /** reference id into an external binary store, for payloads too large to inline. */
  directRef?: string;
}

/** Keyed collection of binary attachments on one item, e.g. { data: {...}, attachment_1: {...} } */
export type BinaryCollection = Record<string, BinaryData>;

/**
 * n8n-style item: one unit of data flowing through the graph. `json` is the
 * structured payload (replaces the old "single JSON blob per node" model —
 * a node's output is now an ARRAY of these), `binary` optionally carries
 * file data alongside it, and `pairedItem` tracks which input item(s) this
 * output item was derived from, so downstream nodes/expressions can align
 * per-item data across branches (mirrors n8n's item-linking).
 */
export interface NodeItem {
  json: Record<string, unknown>;
  binary?: BinaryCollection;
  /** Index (and optionally source node id) of the upstream item this was derived from. */
  pairedItem?: { item: number; sourceNode?: string } | { item: number; sourceNode?: string }[];
}

/** A node's full input/output: an array of items, each with its own json + binary + lineage. */
export type NodeItems = NodeItem[];

export type NodeType =
  | 'webhook'
  | 'schedule'
  | 'httpRequest'
  | 'if'
  | 'switch'
  | 'merge'
  | 'set'
  | 'code'
  | 'email'
  | 'slack'
  | 'googleSheets'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'localLlm'
  | 'groq'
  | 'mistral'
  | 'textClassifier'
  | 'sentimentAnalysis'
  | 'entityExtractor'
  | 'summarizer'
  | 'qaChain'
  | 'ragIngest'
  | 'ragQuery'
  | 'browserAutomation'
  | 'wait'
  | 'forEach'
  | 'discord'
  | 'telegram'
  | 'notion'
  | 'github'
  | 'postgres'
  | 'switch'
  | 'subWorkflow'
  | 'forEachBranch'
  | 'waitForWebhook'
  | 'humanApproval'
  | 'respondToWebhook'
  | 'stripe'
  | 'twilio'
  | 'whatsapp'
  | 'hubspot'
  | 'salesforce'
  | 'shopify'
  | 'awsS3'
  | 'gmail'
  | 'googleCalendar'
  | 'emailTrigger'
  | 'fileWatcher'
  | 'databaseChange'
  | 'streamTrigger'
  | 'chatTrigger'
  | 'agentMemory'
  | 'redisMemory'
  | 'agent'
  | 'agentOrchestrator'
  | 'embeddingProvider'
  | 'textSplitterConfig'
  | 'vectorStoreConfig'
  | 'agentTool'
  | 'dataTableRead'
  | 'dataTableWrite'
  | 'fileExtract'
  | 'fileConvert'
  | 'trello'
  | 'asana'
  | 'clickup'
  | 'linear'
  | 'jira'
  | 'msTeams'
  | 'outlook'
  | 'googleDrive'
  | 'dropbox'
  | 'zoom'
  | 'mongodb'
  | 'mysql'
  | 'sentry'
  | 'pagerduty'
  | 'datadog'
  | 'filter'
  | 'splitOut'
  | 'aggregate'
  | 'sort'
  | 'limit'
  | 'removeDuplicates'
  | 'compareDatasets'
  | 'noOp'
  | 'dateTime'
  | 'htmlExtract'
  | 'markdownHtml'
  | 'xmlJson'
  | 'crypto'
  | 'compression'
  | 'textParser'
  | 'stopAndError'
  | 'rssTrigger'
  | 'mqttTrigger'
  | 'formTrigger'
  | 'executeWorkflowTrigger'
  | 'itemLists'
  | 'renameKeys'
  | 'moveBinaryData'
  | 'simulate'
  | 'debugHelper'
  | 'structuredOutputParser'
  | 'autoFixingOutputParser'
  | 'paypal'
  | 'quickbooks'
  | 'xero'
  | 'zendesk'
  | 'mailchimp'
  | 'sendgrid'
  | 'segment'
  | 'googleAds'
  | 'metaAds'
  | 'amplitude'
  | 'mixpanel'
  | 'calendly'
  | 'docusign'
  | 'elasticsearch'
  | 'sftp'
  | 'linkedin'
  | 'twitter'
  | 'facebook'
  | 'instagram'
  | 'youtube'
  // Community/marketplace nodes register under a namespaced type so they
  // can never collide with a built-in — see communityLoader.ts.
  | `community.${string}`;

/** Manifest describing an installable community/marketplace node package. */
export interface CommunityNodeManifest {
  /** Unique package name, e.g. "flowforge-node-airtable". */
  name: string;
  version: string;
  description: string;
  author?: string;
  /** Node type strings this package registers (without the "community." prefix — the loader adds it). */
  nodeTypes: string[];
  /** npm package name to install from, if different from `name`. */
  npmPackage?: string;
  /** Homepage/repo URL shown in the marketplace UI. */
  homepage?: string;
  /** Where the manifest came from: a curated index, or a raw npm/git install. */
  source: 'registry' | 'npm' | 'local';
  /** Marketplace category, e.g. "CRM", "Support". Only set on curated registry entries. */
  category?: string;
  /** True for entries curated by FlowForge; false for arbitrary npm-name installs. */
  verified?: boolean;
  /** Monthly download count fetched from api.npmjs.org, or null if the lookup failed/is unavailable. */
  downloadsLastMonth?: number | null;
  /** Link to the package's changelog, if known. */
  changelogUrl?: string;
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  label?: string;
  position: { x: number; y: number };
  params: Record<string, unknown>;
  credentialId?: string | null;
  retry?: { maxAttempts: number; delayMs: number } | null;
  continueOnFail?: boolean;
  /** Pin Data: when set, the executor uses `pinnedOutput` verbatim instead
   *  of actually running this node (no credential call, no side effect) —
   *  lets you freeze a known-good output while iterating on downstream
   *  nodes. Set/cleared from the "Test node" panel in the UI. */
  isPinned?: boolean;
  pinnedOutput?: unknown;
}

export interface TestNodeJobData {
  requestId: string;
  nodeType: string;
  params: Record<string, unknown>;
  input: unknown;
  credentialId?: string | null;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null; // e.g. "true" / "false" for IF nodes
  /** Which sub-input port on the target node this connects to (e.g.
   *  "embedding" / "vectorStore" / "tool" / "model" / "memory") — undefined
   *  or "main-in" means the regular main data pipe. */
  targetHandle?: string | null;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export type ExecutionStatus = 'running' | 'success' | 'failed' | 'paused' | 'cancelled';
export type NodeRunStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'paused';

export interface ExecutionJobData {
  executionId: string;
  workflowId: string;
  userId: string;
  triggerType: 'manual' | 'webhook' | 'chatTrigger' | 'schedule' | 'emailTrigger' | 'fileWatcher' | 'databaseChange' | 'streamTrigger' | 'rssTrigger' | 'mqttTrigger' | 'formTrigger' | 'calendlyTrigger' | 'docusignTrigger' | 'test';
  triggerPayload?: unknown;
}

export interface ResumeJobData {
  executionId: string;
  resumeInput: unknown;
}

export interface RetryJobData {
  originalExecutionId: string;
  retryNodeId: string;
}

export type QueueJobData = ExecutionJobData | ResumeJobData | TestNodeJobData | RetryJobData;

// Socket.IO event payloads
export interface NodeStatusEvent {
  executionId: string;
  nodeId: string;
  status: NodeRunStatus;
  output?: unknown;
  error?: string;
  /** Binary attachment metadata (mimeType/fileName/fileSize), plus inline
   *  base64 `preview` for small image/PDF attachments only — populated by
   *  the executor so the canvas can render a thumbnail without shipping
   *  every attachment's full bytes over the socket. */
  binary?: unknown;
}

export interface ExecutionStatusEvent {
  executionId: string;
  workflowId: string;
  status: ExecutionStatus;
}

// ---------------------------------------------------------------------------
// Data Table column types (25-type catalog) — see columnTypes.ts for detail.
// ---------------------------------------------------------------------------
export * from './columnTypes';

// ---------------------------------------------------------------------------
// OAuth2 token provider config — single source of truth for tokenUrl/envs
// shared between apps/api (authorize flow) and apps/worker (refresh helper).
// ---------------------------------------------------------------------------
export * from './oauthTokenProviders';