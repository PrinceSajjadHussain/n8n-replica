/**
 * paramSchemas — web-only, lightweight schema registry describing how to
 * render each node type's `params` as a form instead of raw JSON.
 *
 * This is purely a UI concern: it never changes what gets saved. A schema
 * just tells <ParamForm> which controls to draw and how to read/write keys
 * on the same `params` object that already round-trips through
 * workflowsRouter.put() and resolveExpressions() unchanged. Node types with
 * no entry here simply keep using the Raw JSON editor.
 */

export type FieldType =
  | 'string'
  | 'expression'
  | 'text'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'object'
  | 'array'
  | 'json'
  | 'resource';
interface FieldBase {
  key: string;
  label: string;
  help?: string;
  placeholder?: string;
  default?: unknown;
  /** Field is only rendered when this returns true for the current params. */
  visibleIf?: (params: Record<string, unknown>) => boolean;
  /** Returns an error string, or null if valid. */
  validate?: (value: unknown, params: Record<string, unknown>) => string | null;
}

export interface EnumOption {
  value: string;
  label: string;
}

export type ParamField =
  | (FieldBase & {
      type: 'string' | 'expression' | 'text';
    })
  | (FieldBase & {
      type: 'number';
      min?: number;
      max?: number;
      step?: number;
    })
  | (FieldBase & {
      type: 'boolean';
    })
  | (FieldBase & {
      type: 'enum';
      options: EnumOption[];
    })
  | (FieldBase & {
      type: 'object';
    })
  | (FieldBase & {
      type: 'array';
      itemFields: ParamField[];
      itemLabel?: string;
    })
  | (FieldBase & {
      type: 'json';
      rows?: number;
    })
  | (FieldBase & {
      type: 'resource';
      resource: string;
      nodeType?: string;
    });
export interface ParamSchema {
  fields: ParamField[];
}

export const PARAM_SCHEMAS: Record<string, ParamSchema> = {
  webhook: {
    fields: [
      {
        key: 'path',
        label: 'Path',
        type: 'string',
        placeholder: 'orders',
        help: 'Becomes /webhook/:workflowId/<path>. Letters, numbers, - and _ only.',
        validate: (v) => (v && !/^[a-zA-Z0-9\-_]+$/.test(String(v)) ? 'Only letters, numbers, - and _ are allowed' : null),
      },
      {
        key: 'responseMode',
        label: 'Response mode',
        type: 'enum',
        default: 'immediately',
        options: [
          { value: 'immediately', label: 'Immediately (ack on enqueue)' },
          { value: 'lastNode', label: 'When last node finishes' },
          { value: 'responseNode', label: 'When "Respond to Webhook" node runs' },
        ],
      },
    ],
  },

  schedule: {
    fields: [
      {
        key: 'cron',
        label: 'Cron expression',
        type: 'string',
        placeholder: '*/5 * * * *',
        help: '5 fields: minute hour day-of-month month day-of-week',
      },
    ],
  },

  httpRequest: {
    fields: [
      { key: 'url', label: 'URL', type: 'expression', placeholder: 'https://api.example.com/orders' },
      {
        key: 'method',
        label: 'Method',
        type: 'enum',
        default: 'GET',
        options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m })),
      },
      { key: 'headers', label: 'Headers', type: 'object', help: 'Sent as-is; Authorization is added automatically from an attached credential.' },
      { key: 'body', label: 'Body', type: 'json', rows: 6, visibleIf: (p) => !['GET', 'DELETE'].includes(String(p.method ?? 'GET')) },
      { key: 'downloadBinary', label: 'Download response as binary (file)', type: 'boolean', default: false },
      {
        key: 'binaryPropertyName',
        label: 'Binary property name',
        type: 'string',
        default: 'data',
        visibleIf: (p) => Boolean(p.downloadBinary),
      },
    ],
  },

  openai: {
    fields: [
      { key: 'model', label: 'Model', type: 'string', default: 'gpt-4o-mini', placeholder: 'gpt-4o-mini' },
      { key: 'systemPrompt', label: 'System prompt', type: 'text', help: 'Optional system message.' },
      {
        key: 'prompt',
        label: 'Prompt',
        type: 'expression',
        default: '{{input}}',
        help: 'Use {{input}} to splice in the upstream node\u2019s JSON output.',
      },
      { key: 'temperature', label: 'Temperature', type: 'number', default: 0.3, min: 0, max: 2, step: 0.1 },
      { key: 'jsonMode', label: 'JSON mode (ask the model to return raw JSON)', type: 'boolean', default: false },
    ],
  },

  anthropic: {
    fields: [
      { key: 'model', label: 'Model', type: 'string', default: 'claude-sonnet-4-5-20250929', placeholder: 'claude-sonnet-4-5-20250929' },
      { key: 'systemPrompt', label: 'System prompt', type: 'text', help: 'Optional system message.' },
      {
        key: 'prompt',
        label: 'Prompt',
        type: 'expression',
        default: '{{input}}',
        help: 'Use {{input}} to splice in the upstream node\u2019s JSON output.',
      },
      { key: 'temperature', label: 'Temperature', type: 'number', default: 0.3, min: 0, max: 1, step: 0.1 },
      { key: 'maxTokens', label: 'Max tokens', type: 'number', default: 1024, min: 1, max: 8192, step: 1 },
    ],
  },

  gemini: {
    fields: [
      { key: 'model', label: 'Model', type: 'string', default: 'gemini-2.0-flash', placeholder: 'gemini-2.0-flash' },
      { key: 'systemPrompt', label: 'System prompt', type: 'text', help: 'Optional system instruction.' },
      {
        key: 'prompt',
        label: 'Prompt',
        type: 'expression',
        default: '{{input}}',
        help: 'Use {{input}} to splice in the upstream node\u2019s JSON output.',
      },
      { key: 'temperature', label: 'Temperature', type: 'number', default: 0.3, min: 0, max: 1, step: 0.1 },
      { key: 'maxOutputTokens', label: 'Max output tokens', type: 'number', default: 2048, min: 1, max: 8192, step: 1 },
      { key: 'jsonMode', label: 'JSON mode', type: 'boolean', default: false, help: 'Ask Gemini to return raw JSON; parsed result lands in output.parsed.' },
    ],
  },

  groq: {
    fields: [
      { key: 'model', label: 'Model', type: 'string', default: 'llama-3.3-70b-versatile', placeholder: 'llama-3.3-70b-versatile' },
      { key: 'systemPrompt', label: 'System prompt', type: 'text', help: 'Optional system message.' },
      {
        key: 'prompt',
        label: 'Prompt',
        type: 'expression',
        default: '{{input}}',
        help: 'Use {{input}} to splice in the upstream node\u2019s JSON output.',
      },
      { key: 'temperature', label: 'Temperature', type: 'number', default: 0.3, min: 0, max: 2, step: 0.1 },
      { key: 'jsonMode', label: 'JSON mode (ask the model to return raw JSON)', type: 'boolean', default: false },
    ],
  },

  mistral: {
    fields: [
      { key: 'model', label: 'Model', type: 'string', default: 'mistral-large-latest', placeholder: 'mistral-large-latest' },
      { key: 'systemPrompt', label: 'System prompt', type: 'text', help: 'Optional system message.' },
      {
        key: 'prompt',
        label: 'Prompt',
        type: 'expression',
        default: '{{input}}',
        help: 'Use {{input}} to splice in the upstream node\u2019s JSON output.',
      },
      { key: 'temperature', label: 'Temperature', type: 'number', default: 0.3, min: 0, max: 2, step: 0.1 },
      { key: 'jsonMode', label: 'JSON mode (ask the model to return raw JSON)', type: 'boolean', default: false },
    ],
  },

  textClassifier: {
    fields: [
      {
        key: 'provider', label: 'Provider', type: 'enum', default: 'openai',
        options: [
          { value: 'openai', label: 'OpenAI' },
          { value: 'anthropic', label: 'Anthropic' },
          { value: 'gemini', label: 'Gemini' },
        ],
      },
      { key: 'model', label: 'Model (optional — provider default if blank)', type: 'string' },
      { key: 'text', label: 'Text to classify', type: 'expression', default: '{{input}}' },
      { key: 'categories', label: 'Categories (comma-separated)', type: 'string', placeholder: 'billing, technical, feedback, spam' },
      { key: 'multiLabel', label: 'Allow multiple categories', type: 'boolean', default: false },
    ],
  },

  sentimentAnalysis: {
    fields: [
      {
        key: 'provider', label: 'Provider', type: 'enum', default: 'openai',
        options: [
          { value: 'openai', label: 'OpenAI' },
          { value: 'anthropic', label: 'Anthropic' },
          { value: 'gemini', label: 'Gemini' },
        ],
      },
      { key: 'model', label: 'Model (optional — provider default if blank)', type: 'string' },
      { key: 'text', label: 'Text to analyze', type: 'expression', default: '{{input}}' },
    ],
  },

  entityExtractor: {
    fields: [
      {
        key: 'provider', label: 'Provider', type: 'enum', default: 'openai',
        options: [
          { value: 'openai', label: 'OpenAI' },
          { value: 'anthropic', label: 'Anthropic' },
          { value: 'gemini', label: 'Gemini' },
        ],
      },
      { key: 'model', label: 'Model (optional — provider default if blank)', type: 'string' },
      { key: 'text', label: 'Source text', type: 'expression', default: '{{input}}' },
      {
        key: 'schemaDescription',
        label: 'Fields to extract',
        type: 'text',
        placeholder: 'name: string, email: string, orderTotal: number, isUrgent: boolean',
        help: 'Plain-English field list — one JSON object with these keys comes back, null for any field not found in the text.',
      },
    ],
  },

  structuredOutputParser: {
    fields: [
      { key: 'textField', label: 'Text field (dot-notation, optional)', type: 'string', placeholder: 'response', help: 'Leave blank to parse the whole input item.' },
      {
        key: 'expectedFields',
        label: 'Expected fields',
        type: 'text',
        placeholder: 'name: string, total: number, isUrgent: boolean',
        help: 'Same plain-English shape as Entity Extractor. Leave blank to only check the text is valid JSON, without checking specific fields.',
      },
      {
        key: 'onFailure',
        label: 'On invalid/mismatched JSON',
        type: 'enum',
        default: 'error',
        options: [
          { value: 'error', label: 'Fail the run' },
          { value: 'null', label: 'Continue with parsed: null' },
          { value: 'passthroughRaw', label: 'Continue, keep raw text for inspection' },
        ],
      },
    ],
  },

  autoFixingOutputParser: {
    fields: [
      { key: 'textField', label: 'Text field (dot-notation, optional)', type: 'string', placeholder: 'response', help: 'Leave blank to parse the whole input item.' },
      {
        key: 'expectedFields',
        label: 'Expected fields',
        type: 'text',
        placeholder: 'name: string, total: number, isUrgent: boolean',
        help: 'Sent back to the model as part of the fix-up prompt on retry, so be specific.',
      },
      {
        key: 'provider', label: 'Fix-up provider', type: 'enum', default: 'openai',
        options: [
          { value: 'openai', label: 'OpenAI' },
          { value: 'anthropic', label: 'Anthropic' },
          { value: 'gemini', label: 'Gemini' },
        ],
      },
      { key: 'model', label: 'Model (optional — provider default if blank)', type: 'string' },
      { key: 'maxRetries', label: 'Max fix-up attempts', type: 'number', default: 2, min: 0, max: 5 },
      {
        key: 'onFailure',
        label: 'If still invalid after retries',
        type: 'enum',
        default: 'error',
        options: [
          { value: 'error', label: 'Fail the run' },
          { value: 'null', label: 'Continue with parsed: null' },
        ],
      },
    ],
  },

  summarizer: {
    fields: [
      {
        key: 'provider', label: 'Provider', type: 'enum', default: 'openai',
        options: [
          { value: 'openai', label: 'OpenAI' },
          { value: 'anthropic', label: 'Anthropic' },
          { value: 'gemini', label: 'Gemini' },
        ],
      },
      { key: 'model', label: 'Model (optional — provider default if blank)', type: 'string' },
      { key: 'text', label: 'Text to summarize', type: 'expression', default: '{{input}}' },
      {
        key: 'style', label: 'Style', type: 'enum', default: 'concise',
        options: [
          { value: 'concise', label: 'Concise (N sentences)' },
          { value: 'detailed', label: 'Detailed paragraph' },
          { value: 'bullets', label: 'Bullet points' },
        ],
      },
      { key: 'maxSentences', label: 'Max sentences', type: 'number', default: 3, min: 1, max: 20, step: 1, visibleIf: (p) => p.style === 'concise' || !p.style },
      { key: 'maxBullets', label: 'Max bullets', type: 'number', default: 5, min: 1, max: 20, step: 1, visibleIf: (p) => p.style === 'bullets' },
    ],
  },

  qaChain: {
    fields: [
      {
        key: 'provider', label: 'Provider', type: 'enum', default: 'openai',
        options: [
          { value: 'openai', label: 'OpenAI' },
          { value: 'anthropic', label: 'Anthropic' },
          { value: 'gemini', label: 'Gemini' },
        ],
      },
      { key: 'model', label: 'Model (optional — provider default if blank)', type: 'string' },
      { key: 'context', label: 'Context text', type: 'expression', default: '{{input}}', help: 'The text to answer the question from — no retrieval step, unlike RAG: Query.' },
      { key: 'question', label: 'Question', type: 'text' },
      { key: 'requireContextOnly', label: 'Answer only from context (refuse if not found)', type: 'boolean', default: true },
    ],
  },

  localLlm: {
    fields: [
      {
        key: 'provider',
        label: 'Wire protocol',
        type: 'enum',
        default: 'ollama',
        options: [
          { value: 'ollama', label: 'Ollama (native /api/chat)' },
          { value: 'openaiCompatible', label: 'OpenAI-compatible (/v1/chat/completions — vLLM, LM Studio, llama.cpp)' },
        ],
      },
      {
        key: 'baseUrl',
        label: 'Server URL',
        type: 'string',
        default: 'http://localhost:11434',
        placeholder: 'http://localhost:11434',
        help: 'Base URL of your local model server. Ollama defaults to port 11434; vLLM/LM Studio commonly use 8000/1234.',
      },
      { key: 'model', label: 'Model', type: 'string', default: 'llama3.1', placeholder: 'llama3.1' },
      { key: 'systemPrompt', label: 'System prompt', type: 'text', help: 'Optional system message.' },
      {
        key: 'prompt',
        label: 'Prompt',
        type: 'expression',
        default: '{{input}}',
        help: 'Use {{input}} to splice in the upstream node\u2019s JSON output.',
      },
      { key: 'temperature', label: 'Temperature', type: 'number', default: 0.3, min: 0, max: 2, step: 0.1 },
      { key: 'jsonMode', label: 'JSON mode (ask the model to return raw JSON)', type: 'boolean', default: false },
    ],
  },

  redisMemory: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'read',
        options: [
          { value: 'read', label: 'Read (recent turns + historyText)' },
          { value: 'write', label: 'Write (append turn(s))' },
          { value: 'clear', label: 'Clear session history' },
        ],
      },
      {
        key: 'sessionId',
        label: 'Session ID',
        type: 'expression',
        default: '{{$json.sessionId}}',
        help: 'Usually the chatTrigger\u2019s sessionId, so history is scoped per conversation.',
      },
      {
        key: 'maxTurns',
        label: 'Max turns to read',
        type: 'number',
        default: 20,
        min: 1,
        max: 200,
        step: 1,
        visibleIf: (p) => (p.action ?? 'read') === 'read',
      },
      {
        key: 'role',
        label: 'Role',
        type: 'enum',
        default: 'user',
        options: [
          { value: 'user', label: 'user' },
          { value: 'assistant', label: 'assistant' },
          { value: 'system', label: 'system' },
        ],
        visibleIf: (p) => p.action === 'write',
        help: 'Single-turn shorthand. For writing both the user message and the model reply in one call, use "turns" in Raw JSON instead.',
      },
      {
        key: 'content',
        label: 'Content',
        type: 'expression',
        visibleIf: (p) => p.action === 'write',
      },
      {
        key: 'maxHistory',
        label: 'Max history to retain',
        type: 'number',
        default: 100,
        min: 1,
        max: 2000,
        step: 1,
        visibleIf: (p) => p.action === 'write',
        help: 'Older turns beyond this count are trimmed automatically.',
      },
      {
        key: 'ttlSeconds',
        label: 'Session TTL (seconds)',
        type: 'number',
        min: 0,
        step: 1,
        visibleIf: (p) => p.action === 'write',
        help: 'Optional. Leave 0/empty to keep history forever.',
      },
    ],
  },

  chatTrigger: {
    fields: [
      {
        key: 'path',
        label: 'Chat path',
        type: 'string',
        default: 'default',
        placeholder: 'default',
        help: 'Matches the :path segment in POST /chat/:workflowId/:path.',
        validate: (v) => (v && !/^[a-zA-Z0-9\-_]+$/.test(String(v)) ? 'Only letters, numbers, - and _ are allowed' : null),
      },
      {
        key: 'responseMode',
        label: 'Response mode',
        type: 'enum',
        default: 'lastNode',
        options: [
          { value: 'lastNode', label: 'Reply with final node output (default)' },
          { value: 'responseNode', label: 'Reply via a "Respond to Webhook" node' },
        ],
        help: 'lastNode replies with whatever the workflow\u2019s last node outputs — simplest option, good for a single ragQuery/agent reply. Pick responseNode only if you need to shape the reply explicitly (e.g. combine multiple nodes\u2019 output) with a "Respond to Webhook" node placed wherever the reply is ready.',
      },
    ],
  },

  slack: {
    fields: [
      { key: 'text', label: 'Message text', type: 'expression', placeholder: 'New order received!' },
    ],
  },

  googleSheets: {
    fields: [
      {
        key: 'operation',
        label: 'Operation',
        type: 'enum',
        default: 'append',
        options: [
          { value: 'append', label: 'Append rows' },
          { value: 'get', label: 'Get rows' },
        ],
      },
      { key: 'spreadsheetId', label: 'Spreadsheet ID', type: 'string', placeholder: '1BxiMV...' },
      { key: 'range', label: 'Range', type: 'string', placeholder: 'Sheet1!A:C' },
      {
        key: 'values',
        label: 'Values (rows x cols JSON)',
        type: 'json',
        rows: 4,
        help: 'Append only. If omitted, each input item\u2019s fields become one row.',
        visibleIf: (p) => (p.operation ?? 'append') === 'append',
      },
    ],
  },

  if: {
    // Conditions live entirely on IfConditionsEditor (multi-row, AND/OR) —
    // see NodeConfigPanel and ifNode.ts's params.conditions/combinator.
    fields: [],
  },

  switch: {
    // Field-to-match lives here; cases themselves stay on SwitchCasesEditor
    // (order-sensitive priority list — a generic array editor would lose
    // the up/down reordering UX that component already provides).
    fields: [{ key: 'field', label: 'Field (dot path)', type: 'string', placeholder: 'status' }],
  },

  set: {
    fields: [
      {
        key: 'mappings',
        label: 'Field mappings',
        type: 'array',
        itemLabel: 'mapping',
        itemFields: [
          { key: 'targetPath', label: 'Target path', type: 'string', placeholder: 'summary' },
          { key: 'sourcePath', label: 'Source path (optional)', type: 'string', placeholder: 'input.field' },
          { key: 'staticValue', label: 'Static value (if no source path)', type: 'expression' },
        ],
      },
      { key: 'dropBinary', label: 'Drop binary data from output', type: 'boolean', default: false },
    ],
  },

  splitOut: {
    fields: [
      { key: 'fieldToSplitOut', label: 'Field to split out', type: 'string', placeholder: 'items', help: 'Dot-notation path to the array field. Each element becomes its own item.' },
      { key: 'destinationField', label: 'Destination field (optional)', type: 'string', placeholder: 'defaults to the same field', help: 'Where the single element is written on each output item.' },
    ],
  },

  aggregate: {
    fields: [
      {
        key: 'mode',
        label: 'Mode',
        type: 'enum',
        default: 'field',
        options: [
          { value: 'field', label: 'Aggregate one field' },
          { value: 'allItems', label: 'Aggregate all items' },
        ],
      },
      { key: 'field', label: 'Field', type: 'string', placeholder: 'email', visibleIf: (p) => p.mode !== 'allItems' },
      { key: 'destinationField', label: 'Destination field', type: 'string', placeholder: 'items', help: 'Name of the array field on the single output item.' },
    ],
  },

  sort: {
    fields: [
      { key: 'field', label: 'Field to sort by', type: 'string', placeholder: 'createdAt' },
      {
        key: 'order',
        label: 'Order',
        type: 'enum',
        default: 'asc',
        options: [
          { value: 'asc', label: 'Ascending' },
          { value: 'desc', label: 'Descending' },
        ],
      },
    ],
  },

  limit: {
    fields: [
      { key: 'maxItems', label: 'Max items', type: 'number', default: 1, min: 0 },
      {
        key: 'keep',
        label: 'Keep',
        type: 'enum',
        default: 'first',
        options: [
          { value: 'first', label: 'First items' },
          { value: 'last', label: 'Last items' },
        ],
      },
    ],
  },

  removeDuplicates: {
    fields: [
      { key: 'field', label: 'Compare field (optional)', type: 'string', placeholder: 'email', help: 'Leave blank to compare entire items instead of a single field.' },
    ],
  },

  itemLists: {
    fields: [
      {
        key: 'mode',
        label: 'Operation',
        type: 'enum',
        default: 'chunk',
        options: [
          { value: 'chunk', label: 'Chunk — split items into fixed-size batches' },
          { value: 'flatten', label: 'Flatten — unwrap a nested array field into individual items' },
          { value: 'dedupe', label: 'Deduplicate — remove items with a duplicate key value (preserves order, first-seen wins)' },
        ],
      },
      {
        key: 'chunkSize',
        label: 'Chunk size',
        type: 'number',
        default: 5,
        min: 1,
        help: 'How many source items go into each output chunk.',
        visibleIf: (p) => p.mode === 'chunk' || !p.mode,
      },
      {
        key: 'destinationField',
        label: 'Destination field',
        type: 'string',
        placeholder: 'chunk',
        help: 'Name of the array field on each output item that holds the chunk. Defaults to "chunk".',
        visibleIf: (p) => p.mode === 'chunk' || !p.mode,
      },
      {
        key: 'field',
        label: 'Field to flatten',
        type: 'string',
        placeholder: 'results',
        help: 'Dot-notation path to the array field whose elements become individual items.',
        visibleIf: (p) => p.mode === 'flatten',
      },
      {
        key: 'depth',
        label: 'Flatten depth',
        type: 'enum',
        default: 'shallow',
        options: [
          { value: 'shallow', label: 'Shallow (one level)' },
          { value: 'deep', label: 'Deep (all levels)' },
        ],
        visibleIf: (p) => p.mode === 'flatten',
      },
      {
        key: 'key',
        label: 'Key field',
        type: 'string',
        placeholder: 'email',
        help: 'Dot-notation path used to detect duplicates. Leave blank to compare the entire item JSON.',
        visibleIf: (p) => p.mode === 'dedupe',
      },
    ],
  },

  compareDatasets: {
    fields: [
      {
        key: 'matchFields',
        label: 'Match fields (comma-separated)',
        type: 'string',
        placeholder: 'id',
        help: 'Dot-paths used to decide two rows are "the same record" between Dataset A and Dataset B. Leave blank to match on the entire item.',
      },
      {
        key: 'compareFields',
        label: 'Compare fields (comma-separated, optional)',
        type: 'string',
        placeholder: 'status,updatedAt',
        help: 'Once matched, which fields decide "same" vs "different". Leave blank to compare the entire item.',
      },
    ],
  },

  executeWorkflowTrigger: {
    fields: [
      {
        key: 'inputSchema',
        label: 'Expected input fields',
        type: 'array',
        itemLabel: 'Field',
        itemFields: [
          { key: 'name', label: 'Field name', type: 'string', placeholder: 'orderId' },
          {
            key: 'type',
            label: 'Type',
            type: 'enum',
            default: 'string',
            options: [
              { value: 'string', label: 'String' },
              { value: 'number', label: 'Number' },
              { value: 'boolean', label: 'Boolean' },
              { value: 'object', label: 'Object' },
              { value: 'array', label: 'Array' },
            ],
          },
          { key: 'required', label: 'Required', type: 'boolean', default: false },
        ],
        help: 'Declares the shape a caller\'s subWorkflow node must pass in. Leave empty to accept anything.',
      },
    ],
  },

  noOp: { fields: [] },

  dateTime: {
    fields: [
      {
        key: 'operation',
        label: 'Operation',
        type: 'enum',
        default: 'format',
        options: [
          { value: 'format', label: 'Format a date' },
          { value: 'addSubtract', label: 'Add / subtract' },
          { value: 'difference', label: 'Difference between two dates' },
          { value: 'now', label: 'Current date/time' },
        ],
      },
      { key: 'sourceField', label: 'Source field', type: 'string', placeholder: 'createdAt', visibleIf: (p) => p.operation !== 'now' },
      { key: 'compareField', label: 'Compare with field', type: 'string', placeholder: 'updatedAt', visibleIf: (p) => p.operation === 'difference' },
      {
        key: 'amount',
        label: 'Amount',
        type: 'number',
        default: 0,
        help: 'Can be negative to subtract.',
        visibleIf: (p) => p.operation === 'addSubtract',
      },
      {
        key: 'unit',
        label: 'Unit',
        type: 'enum',
        default: 'days',
        options: [
          { value: 'seconds', label: 'Seconds' },
          { value: 'minutes', label: 'Minutes' },
          { value: 'hours', label: 'Hours' },
          { value: 'days', label: 'Days' },
          { value: 'weeks', label: 'Weeks' },
          { value: 'months', label: 'Months' },
          { value: 'years', label: 'Years' },
        ],
        visibleIf: (p) => p.operation === 'addSubtract' || p.operation === 'difference',
      },
      {
        key: 'format',
        label: 'Output format',
        type: 'enum',
        default: 'iso',
        options: [
          { value: 'iso', label: 'ISO 8601' },
          { value: 'unix', label: 'Unix timestamp (seconds)' },
          { value: 'unixMs', label: 'Unix timestamp (ms)' },
          { value: 'date', label: 'Date only (YYYY-MM-DD)' },
          { value: 'time', label: 'Time only (HH:mm:ss)' },
          { value: 'locale', label: 'Locale string' },
        ],
        visibleIf: (p) => p.operation !== 'difference',
      },
      { key: 'destinationField', label: 'Destination field', type: 'string', placeholder: 'date' },
    ],
  },

  htmlExtract: {
    fields: [
      { key: 'sourceField', label: 'Source field (HTML)', type: 'string', placeholder: 'html' },
      {
        key: 'extractions',
        label: 'Extractions',
        type: 'array',
        itemLabel: 'Field',
        itemFields: [
          { key: 'key', label: 'Output field', type: 'string', placeholder: 'title' },
          { key: 'selector', label: 'CSS selector', type: 'string', placeholder: 'h1.title' },
          { key: 'attribute', label: 'Attribute (optional)', type: 'string', placeholder: 'href' },
          { key: 'multiple', label: 'Collect all matches', type: 'boolean', default: false },
        ],
      },
    ],
  },

  markdownHtml: {
    fields: [
      {
        key: 'direction',
        label: 'Direction',
        type: 'enum',
        default: 'toHtml',
        options: [
          { value: 'toHtml', label: 'Markdown → HTML' },
          { value: 'toMarkdown', label: 'HTML → Markdown' },
        ],
      },
      { key: 'sourceField', label: 'Source field', type: 'string', placeholder: 'markdown' },
      { key: 'destinationField', label: 'Destination field', type: 'string', placeholder: 'html' },
    ],
  },

  xmlJson: {
    fields: [
      {
        key: 'direction',
        label: 'Direction',
        type: 'enum',
        default: 'toJson',
        options: [
          { value: 'toJson', label: 'XML → JSON' },
          { value: 'toXml', label: 'JSON → XML' },
        ],
      },
      { key: 'sourceField', label: 'Source field', type: 'string', placeholder: 'xml' },
      { key: 'destinationField', label: 'Destination field', type: 'string', placeholder: 'json' },
      { key: 'rootName', label: 'Root element name (toXml)', type: 'string', default: 'root', visibleIf: (p) => p.direction === 'toXml' },
    ],
  },

  crypto: {
    fields: [
      {
        key: 'operation',
        label: 'Operation',
        type: 'enum',
        default: 'hash',
        options: [
          { value: 'hash', label: 'Hash' },
          { value: 'hmac', label: 'HMAC' },
          { value: 'sign', label: 'Sign (asymmetric)' },
          { value: 'randomBytes', label: 'Generate random bytes' },
        ],
      },
      { key: 'algorithm', label: 'Algorithm', type: 'string', default: 'sha256', placeholder: 'sha256', visibleIf: (p) => p.operation !== 'randomBytes' },
      { key: 'sourceField', label: 'Source field', type: 'string', placeholder: 'payload', visibleIf: (p) => p.operation !== 'randomBytes' },
      { key: 'secret', label: 'HMAC secret', type: 'string', visibleIf: (p) => p.operation === 'hmac' },
      { key: 'privateKeyField', label: 'Private key field (PEM)', type: 'string', placeholder: 'privateKey', visibleIf: (p) => p.operation === 'sign' },
      { key: 'byteLength', label: 'Byte length', type: 'number', default: 16, visibleIf: (p) => p.operation === 'randomBytes' },
      {
        key: 'encoding',
        label: 'Output encoding',
        type: 'enum',
        default: 'hex',
        options: [
          { value: 'hex', label: 'Hex' },
          { value: 'base64', label: 'Base64' },
        ],
      },
      { key: 'destinationField', label: 'Destination field', type: 'string', placeholder: 'hash' },
    ],
  },

  compression: {
    fields: [
      {
        key: 'operation',
        label: 'Operation',
        type: 'enum',
        default: 'gzip',
        options: [
          { value: 'zip', label: 'Zip' },
          { value: 'unzip', label: 'Unzip' },
          { value: 'gzip', label: 'Gzip' },
          { value: 'gunzip', label: 'Gunzip' },
        ],
      },
      { key: 'binaryProperty', label: 'Input binary property', type: 'string', default: 'data' },
      { key: 'destinationProperty', label: 'Output binary property', type: 'string', default: 'data' },
      { key: 'fileName', label: 'File name (optional)', type: 'string' },
    ],
  },

  textParser: {
    fields: [
      {
        key: 'operation',
        label: 'Operation',
        type: 'enum',
        default: 'match',
        options: [
          { value: 'match', label: 'Match (first)' },
          { value: 'matchAll', label: 'Match all' },
          { value: 'test', label: 'Test (true/false)' },
          { value: 'split', label: 'Split' },
          { value: 'replace', label: 'Replace' },
        ],
      },
      { key: 'sourceField', label: 'Source field', type: 'string', placeholder: 'text' },
      { key: 'pattern', label: 'Pattern (regex, or separator for Split)', type: 'string', placeholder: '\\d+' },
      { key: 'flags', label: 'Regex flags', type: 'string', placeholder: 'gi', visibleIf: (p) => p.operation !== 'split' },
      { key: 'replacement', label: 'Replacement', type: 'string', placeholder: '$1', visibleIf: (p) => p.operation === 'replace' },
      { key: 'destinationField', label: 'Destination field', type: 'string', default: 'result' },
    ],
  },

  stopAndError: {
    fields: [
      { key: 'message', label: 'Error message', type: 'string', placeholder: 'Order total cannot be negative' },
      { key: 'messageField', label: 'Or read message from field (optional)', type: 'string', placeholder: 'validationError', help: 'Dot-notation path into the input item. Overrides the static message above when set.' },
    ],
  },

  renameKeys: {
    fields: [
      {
        key: 'mappings',
        label: 'Rename',
        type: 'array',
        itemLabel: 'mapping',
        itemFields: [
          { key: 'from', label: 'From (dot-notation path)', type: 'string', placeholder: 'customer.fullName' },
          { key: 'to', label: 'To (dot-notation path)', type: 'string', placeholder: 'customerName' },
        ],
      },
      { key: 'removeOthers', label: 'Output only the renamed fields', type: 'boolean', default: false, help: 'When off, every other field passes through unchanged.' },
    ],
  },

  moveBinaryData: {
    fields: [
      {
        key: 'mode',
        label: 'Direction',
        type: 'enum',
        default: 'binaryToJson',
        options: [
          { value: 'binaryToJson', label: 'Binary → JSON' },
          { value: 'jsonToBinary', label: 'JSON → Binary' },
        ],
      },
      { key: 'binaryProperty', label: 'Binary property name', type: 'string', default: 'data', placeholder: 'data' },
      { key: 'jsonField', label: 'JSON field (dot-notation)', type: 'string', default: 'data', placeholder: 'data' },
      { key: 'parseAsJson', label: 'Parse decoded text as JSON', type: 'boolean', default: false, visibleIf: (p) => p.mode !== 'jsonToBinary', help: 'Binary → JSON only. Off = write base64 text; on = JSON.parse the decoded bytes (falls back to text on parse failure).' },
      { key: 'mimeType', label: 'MIME type', type: 'string', default: 'application/octet-stream', visibleIf: (p) => p.mode === 'jsonToBinary' },
      { key: 'fileName', label: 'File name (optional)', type: 'string', visibleIf: (p) => p.mode === 'jsonToBinary' },
    ],
  },

  simulate: {
    fields: [
      {
        key: 'mode',
        label: 'Mode',
        type: 'enum',
        default: 'data',
        options: [
          { value: 'data', label: 'Fabricate data' },
          { value: 'error', label: 'Fabricate an error' },
        ],
      },
      { key: 'jsonData', label: 'Fabricated JSON (object or array)', type: 'json', rows: 6, visibleIf: (p) => p.mode !== 'error', help: 'Leave blank to pass input through unchanged.' },
      { key: 'errorMessage', label: 'Error message', type: 'string', placeholder: 'Simulated failure', visibleIf: (p) => p.mode === 'error' },
      { key: 'simulatedDelayMs', label: 'Simulated delay (ms, optional)', type: 'number', min: 0, max: 30000, default: 0 },
    ],
  },

  debugHelper: {
    fields: [
      {
        key: 'errorType',
        label: 'Failure to simulate',
        type: 'enum',
        default: 'generic',
        options: [
          { value: 'generic', label: 'Generic error' },
          { value: 'timeout', label: 'Timeout (5s hang, then fails)' },
          { value: 'invalidJson', label: 'Invalid JSON response' },
          { value: 'largePayload', label: 'Oversized payload (~5MB)' },
          { value: 'none', label: 'None — pass through' },
        ],
      },
      { key: 'message', label: 'Message (generic only)', type: 'string', placeholder: 'Simulated generic failure', visibleIf: (p) => p.errorType === 'generic' },
    ],
  },

  rssTrigger: {
    fields: [
      { key: 'feedUrl', label: 'Feed URL', type: 'string', placeholder: 'https://example.com/feed.xml' },
      { key: 'pollIntervalSec', label: 'Poll interval (seconds)', type: 'number', default: 300, min: 30, help: 'Minimum 30s. The first poll after activating never fires items — it only records what already exists, so activation doesn\'t replay the whole feed history.' },
    ],
  },

  mqttTrigger: {
    fields: [
      { key: 'brokerUrl', label: 'Broker URL', type: 'string', placeholder: 'mqtt://broker.example.com:1883' },
      { key: 'topic', label: 'Topic', type: 'string', placeholder: 'sensors/+/temperature', help: 'MQTT wildcards + and # are supported.' },
      { key: 'username', label: 'Username (optional)', type: 'string' },
      { key: 'password', label: 'Password (optional)', type: 'string' },
      {
        key: 'qos',
        label: 'QoS',
        type: 'enum',
        default: 0,
        options: [
          { value: '0', label: '0 — at most once' },
          { value: '1', label: '1 — at least once' },
          { value: '2', label: '2 — exactly once' },
        ],
      },
    ],
  },

  formTrigger: {
    fields: [
      { key: 'path', label: 'Path', type: 'string', placeholder: 'contact', help: 'Becomes /form/:workflowId/<path>' },
      { key: 'title', label: 'Form title', type: 'string', placeholder: 'Contact us' },
      {
        key: 'fields',
        label: 'Form fields',
        type: 'array',
        itemLabel: 'field',
        itemFields: [
          { key: 'name', label: 'Field name', type: 'string', placeholder: 'email' },
          { key: 'label', label: 'Label', type: 'string', placeholder: 'Email address' },
          {
            key: 'type',
            label: 'Input type',
            type: 'enum',
            default: 'text',
            options: [
              { value: 'text', label: 'Text' },
              { value: 'textarea', label: 'Textarea' },
              { value: 'email', label: 'Email' },
              { value: 'number', label: 'Number' },
              { value: 'date', label: 'Date' },
              { value: 'checkbox', label: 'Checkbox' },
            ],
          },
          { key: 'required', label: 'Required', type: 'boolean', default: false },
        ],
      },
      { key: 'submitLabel', label: 'Submit button label', type: 'string', default: 'Submit' },
      { key: 'thankYouMessage', label: 'Thank-you message', type: 'string', default: 'Thanks — your submission was received.' },
      {
        key: 'responseMode',
        label: 'Response mode',
        type: 'enum',
        default: 'immediately',
        options: [
          { value: 'immediately', label: 'Show thank-you immediately (ack on enqueue)' },
          { value: 'lastNode', label: 'Wait for the workflow to finish first' },
        ],
      },
    ],
  },

  linkedin: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'createPost',
        options: [
          { value: 'createPost', label: 'Create post' },
          { value: 'getProfile', label: 'Get my profile' },
        ],
      },
      {
        key: 'text',
        label: 'Post text',
        type: 'expression',
        placeholder: 'Excited to share...',
        visibleIf: (p) => (p.action ?? 'createPost') === 'createPost',
      },
      {
        key: 'visibility',
        label: 'Visibility',
        type: 'enum',
        default: 'PUBLIC',
        options: [
          { value: 'PUBLIC', label: 'Public' },
          { value: 'CONNECTIONS', label: 'Connections only' },
        ],
        visibleIf: (p) => (p.action ?? 'createPost') === 'createPost',
      },
    ],
  },

  twitter: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'createTweet',
        options: [
          { value: 'createTweet', label: 'Create tweet' },
          { value: 'getUser', label: 'Get user' },
        ],
      },
      {
        key: 'text',
        label: 'Tweet text',
        type: 'expression',
        placeholder: "What's happening?",
        visibleIf: (p) => (p.action ?? 'createTweet') === 'createTweet',
      },
      {
        key: 'username',
        label: 'Username (optional)',
        type: 'string',
        placeholder: 'jack',
        help: 'Leave blank to look up the authenticated user.',
        visibleIf: (p) => p.action === 'getUser',
      },
    ],
  },

  facebook: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'createPost',
        options: [{ value: 'createPost', label: 'Create post' }],
      },
      { key: 'message', label: 'Message', type: 'expression', placeholder: 'Big news!' },
      { key: 'link', label: 'Link (optional)', type: 'string', placeholder: 'https://example.com' },
    ],
  },

  instagram: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'createPost',
        options: [{ value: 'createPost', label: 'Create post' }],
      },
      { key: 'imageUrl', label: 'Image URL', type: 'string', placeholder: 'https://example.com/image.jpg' },
      { key: 'caption', label: 'Caption', type: 'expression', placeholder: 'Caption goes here...' },
    ],
  },

  trello: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'createCard',
        options: [
          { value: 'createCard', label: 'Create card' },
          { value: 'getCard', label: 'Get card' },
          { value: 'addComment', label: 'Add comment' },
        ],
      },
      { key: 'listId', label: 'List ID', type: 'string', placeholder: '5f8...', visibleIf: (p) => (p.action ?? 'createCard') === 'createCard' },
      { key: 'name', label: 'Card title', type: 'expression', placeholder: 'New card', visibleIf: (p) => (p.action ?? 'createCard') === 'createCard' },
      { key: 'desc', label: 'Description', type: 'expression', visibleIf: (p) => (p.action ?? 'createCard') === 'createCard' },
      { key: 'cardId', label: 'Card ID', type: 'string', placeholder: '5f8...', visibleIf: (p) => p.action === 'getCard' || p.action === 'addComment' },
      { key: 'text', label: 'Comment text', type: 'expression', visibleIf: (p) => p.action === 'addComment' },
    ],
  },

  jira: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'createIssue',
        options: [
          { value: 'createIssue', label: 'Create issue' },
          { value: 'getIssue', label: 'Get issue' },
          { value: 'addComment', label: 'Add comment' },
        ],
      },
      { key: 'projectKey', label: 'Project key', type: 'string', placeholder: 'ENG', visibleIf: (p) => (p.action ?? 'createIssue') === 'createIssue' },
      { key: 'summary', label: 'Summary', type: 'expression', placeholder: 'New issue', visibleIf: (p) => (p.action ?? 'createIssue') === 'createIssue' },
      {
        key: 'issueType',
        label: 'Issue type',
        type: 'enum',
        default: 'Task',
        options: [
          { value: 'Task', label: 'Task' },
          { value: 'Bug', label: 'Bug' },
          { value: 'Story', label: 'Story' },
        ],
        visibleIf: (p) => (p.action ?? 'createIssue') === 'createIssue',
      },
      { key: 'issueKey', label: 'Issue key', type: 'string', placeholder: 'ENG-123', visibleIf: (p) => p.action === 'getIssue' || p.action === 'addComment' },
      { key: 'content', label: 'Comment text', type: 'expression', visibleIf: (p) => p.action === 'addComment' },
    ],
  },

  discord: {
    fields: [
      { key: 'content', label: 'Message content', type: 'expression', placeholder: 'Deploy finished ✅' },
      { key: 'username', label: 'Override webhook username (optional)', type: 'string', placeholder: 'FlowForge Bot' },
    ],
  },

  telegram: {
    fields: [
      { key: 'chatId', label: 'Chat ID', type: 'string', placeholder: '-1001234567890', help: 'Numeric chat/channel/group ID the bot has access to.' },
      { key: 'text', label: 'Message text', type: 'expression', placeholder: 'Hello from FlowForge!' },
      {
        key: 'parseMode',
        label: 'Parse mode',
        type: 'enum',
        default: '',
        options: [
          { value: '', label: 'None (plain text)' },
          { value: 'Markdown', label: 'Markdown' },
          { value: 'HTML', label: 'HTML' },
        ],
      },
    ],
  },

  email: {
    fields: [
      { key: 'to', label: 'To', type: 'expression', placeholder: 'someone@example.com' },
      { key: 'subject', label: 'Subject', type: 'expression', placeholder: 'Hello' },
      { key: 'body', label: 'Body', type: 'expression', placeholder: 'Message body...' },
      { key: 'html', label: 'Body is HTML', type: 'boolean', default: false },
    ],
  },

  outlook: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'sendMail',
        options: [
          { value: 'sendMail', label: 'Send mail' },
          { value: 'listEvents', label: 'List calendar events' },
          { value: 'createEvent', label: 'Create calendar event' },
        ],
      },
      { key: 'to', label: 'To', type: 'expression', placeholder: 'someone@example.com', visibleIf: (p) => (p.action ?? 'sendMail') === 'sendMail' },
      { key: 'subject', label: 'Subject', type: 'expression', visibleIf: (p) => (p.action ?? 'sendMail') === 'sendMail' },
      { key: 'body', label: 'Body', type: 'expression', visibleIf: (p) => (p.action ?? 'sendMail') === 'sendMail' },
      { key: 'timeMin', label: 'From (ISO datetime)', type: 'string', placeholder: '2026-07-01T00:00:00Z', visibleIf: (p) => p.action === 'listEvents' },
      { key: 'timeMax', label: 'To (ISO datetime)', type: 'string', placeholder: '2026-07-31T23:59:59Z', visibleIf: (p) => p.action === 'listEvents' },
      { key: 'event', label: 'Event (JSON)', type: 'json', rows: 4, help: 'Microsoft Graph event object, e.g. { "subject": "...", "start": {...}, "end": {...} }', visibleIf: (p) => p.action === 'createEvent' },
    ],
  },

  googleDrive: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'listFiles',
        options: [
          { value: 'listFiles', label: 'List files' },
          { value: 'downloadFile', label: 'Download file' },
          { value: 'uploadFile', label: 'Upload file' },
        ],
      },
      { key: 'query', label: 'Search query', type: 'string', placeholder: "name contains 'report'", visibleIf: (p) => (p.action ?? 'listFiles') === 'listFiles' },
      { key: 'fileId', label: 'File ID', type: 'string', placeholder: '1A2b3C...', visibleIf: (p) => p.action === 'downloadFile' },
      { key: 'fileName', label: 'File name', type: 'string', placeholder: 'report.txt', visibleIf: (p) => p.action === 'uploadFile' },
      { key: 'mimeType', label: 'MIME type', type: 'string', placeholder: 'text/plain', visibleIf: (p) => p.action === 'uploadFile' },
      { key: 'content', label: 'File content', type: 'expression', visibleIf: (p) => p.action === 'uploadFile' },
    ],
  },

  zoom: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'createMeeting',
        options: [
          { value: 'createMeeting', label: 'Create meeting' },
          { value: 'getMeeting', label: 'Get meeting' },
          { value: 'listRecordings', label: 'List recordings' },
        ],
      },
      { key: 'topic', label: 'Meeting topic', type: 'expression', placeholder: 'Weekly sync', visibleIf: (p) => (p.action ?? 'createMeeting') === 'createMeeting' },
      { key: 'startTime', label: 'Start time (ISO)', type: 'string', placeholder: '2026-08-01T15:00:00Z', visibleIf: (p) => (p.action ?? 'createMeeting') === 'createMeeting' },
      { key: 'duration', label: 'Duration (minutes)', type: 'number', default: 30, visibleIf: (p) => (p.action ?? 'createMeeting') === 'createMeeting' },
      { key: 'meetingId', label: 'Meeting ID', type: 'string', visibleIf: (p) => p.action === 'getMeeting' },
      { key: 'userId', label: 'User ID (optional, default "me")', type: 'string', visibleIf: (p) => p.action === 'listRecordings' },
      { key: 'from', label: 'From date', type: 'string', placeholder: '2026-07-01', visibleIf: (p) => p.action === 'listRecordings' },
      { key: 'to', label: 'To date', type: 'string', placeholder: '2026-07-31', visibleIf: (p) => p.action === 'listRecordings' },
    ],
  },

  mongodb: {
    fields: [
      { key: 'database', label: 'Database', type: 'string', placeholder: 'mydb' },
      { key: 'collection', label: 'Collection', type: 'string', placeholder: 'orders' },
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'find',
        options: [
          { value: 'find', label: 'Find' },
          { value: 'insertOne', label: 'Insert one' },
          { value: 'updateOne', label: 'Update one' },
          { value: 'deleteOne', label: 'Delete one' },
        ],
      },
      { key: 'filter', label: 'Filter (JSON)', type: 'json', rows: 3, default: {}, visibleIf: (p) => ['find', 'updateOne', 'deleteOne'].includes(String(p.action ?? 'find')) },
      { key: 'limit', label: 'Limit', type: 'number', default: 100, visibleIf: (p) => (p.action ?? 'find') === 'find' },
      { key: 'document', label: 'Document (JSON)', type: 'json', rows: 4, default: {}, visibleIf: (p) => p.action === 'insertOne' },
      { key: 'update', label: 'Update (JSON)', type: 'json', rows: 3, default: { $set: {} }, help: 'MongoDB update operators, e.g. { "$set": { "status": "done" } }', visibleIf: (p) => p.action === 'updateOne' },
    ],
  },

  sentry: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'listIssues',
        options: [
          { value: 'listIssues', label: 'List issues' },
          { value: 'getIssue', label: 'Get issue' },
          { value: 'resolveIssue', label: 'Resolve issue' },
        ],
      },
      { key: 'projectSlug', label: 'Project slug', type: 'string', placeholder: 'my-project', visibleIf: (p) => (p.action ?? 'listIssues') === 'listIssues' },
      { key: 'query', label: 'Search query', type: 'string', default: 'is:unresolved', visibleIf: (p) => (p.action ?? 'listIssues') === 'listIssues' },
      { key: 'issueId', label: 'Issue ID', type: 'string', visibleIf: (p) => p.action === 'getIssue' || p.action === 'resolveIssue' },
    ],
  },

  sendgrid: {
    fields: [
      { key: 'to', label: 'To', type: 'expression', placeholder: 'someone@example.com' },
      { key: 'from', label: 'From', type: 'expression', placeholder: 'alerts@yourdomain.com' },
      { key: 'subject', label: 'Subject', type: 'expression', placeholder: 'Hello' },
      { key: 'text', label: 'Plain text body', type: 'expression', help: 'Used unless an HTML body is also set below.' },
      { key: 'html', label: 'HTML body (optional)', type: 'expression' },
    ],
  },

  youtube: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'listVideos',
        options: [
          { value: 'listVideos', label: 'List videos' },
          { value: 'updateVideo', label: 'Update video' },
        ],
      },
      { key: 'channelId', label: 'Channel ID (optional, defaults to your channel)', type: 'string', visibleIf: (p) => (p.action ?? 'listVideos') === 'listVideos' },
      { key: 'videoId', label: 'Video ID', type: 'string', placeholder: 'dQw4w9WgXcQ', visibleIf: (p) => p.action === 'updateVideo' },
      { key: 'snippet', label: 'Snippet (JSON)', type: 'json', rows: 3, default: { title: '', description: '' }, help: 'Fields to update, e.g. { "title": "New title" }', visibleIf: (p) => p.action === 'updateVideo' },
    ],
  },

  asana: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'createTask',
        options: [
          { value: 'createTask', label: 'Create task' },
          { value: 'getTask', label: 'Get task' },
          { value: 'updateTask', label: 'Update task' },
          { value: 'listTasksInProject', label: 'List tasks in project' },
          { value: 'addComment', label: 'Add comment' },
        ],
      },
      { key: 'projectId', label: 'Project ID', type: 'string', visibleIf: (p) => ['createTask', 'listTasksInProject'].includes(String(p.action ?? 'createTask')) },
      { key: 'name', label: 'Task name', type: 'expression', visibleIf: (p) => ['createTask', 'updateTask'].includes(String(p.action ?? 'createTask')) },
      { key: 'notes', label: 'Notes', type: 'expression', visibleIf: (p) => ['createTask', 'updateTask'].includes(String(p.action ?? 'createTask')) },
      { key: 'completed', label: 'Completed', type: 'boolean', default: false, visibleIf: (p) => p.action === 'updateTask' },
      { key: 'taskId', label: 'Task ID', type: 'string', visibleIf: (p) => ['getTask', 'updateTask', 'addComment'].includes(String(p.action ?? '')) },
      { key: 'text', label: 'Comment text', type: 'expression', visibleIf: (p) => p.action === 'addComment' },
    ],
  },

  clickup: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'createTask',
        options: [
          { value: 'createTask', label: 'Create task' },
          { value: 'getTask', label: 'Get task' },
          { value: 'updateTask', label: 'Update task' },
          { value: 'listTasksInList', label: 'List tasks in list' },
        ],
      },
      { key: 'listId', label: 'List ID', type: 'string', visibleIf: (p) => ['createTask', 'listTasksInList'].includes(String(p.action ?? 'createTask')) },
      { key: 'name', label: 'Task name', type: 'expression', visibleIf: (p) => ['createTask', 'updateTask'].includes(String(p.action ?? 'createTask')) },
      { key: 'description', label: 'Description', type: 'expression', visibleIf: (p) => ['createTask', 'updateTask'].includes(String(p.action ?? 'createTask')) },
      { key: 'status', label: 'Status', type: 'string', placeholder: 'in progress', visibleIf: (p) => ['createTask', 'updateTask'].includes(String(p.action ?? 'createTask')) },
      { key: 'taskId', label: 'Task ID', type: 'string', visibleIf: (p) => p.action === 'getTask' || p.action === 'updateTask' },
    ],
  },

  linear: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'createIssue',
        options: [
          { value: 'createIssue', label: 'Create issue' },
          { value: 'getIssue', label: 'Get issue' },
          { value: 'updateIssue', label: 'Update issue' },
        ],
      },
      { key: 'teamId', label: 'Team ID', type: 'string', visibleIf: (p) => (p.action ?? 'createIssue') === 'createIssue' },
      { key: 'title', label: 'Title', type: 'expression', visibleIf: (p) => ['createIssue', 'updateIssue'].includes(String(p.action ?? 'createIssue')) },
      { key: 'description', label: 'Description', type: 'expression', visibleIf: (p) => ['createIssue', 'updateIssue'].includes(String(p.action ?? 'createIssue')) },
      { key: 'stateId', label: 'State ID', type: 'string', visibleIf: (p) => p.action === 'updateIssue' },
      { key: 'issueId', label: 'Issue ID', type: 'string', visibleIf: (p) => p.action === 'getIssue' || p.action === 'updateIssue' },
    ],
  },

  msTeams: {
    fields: [
      { key: 'title', label: 'Title (optional)', type: 'expression', placeholder: 'Deploy status' },
      { key: 'text', label: 'Message text', type: 'expression', placeholder: 'Build succeeded ✅' },
    ],
  },

  mysql: {
    fields: [
      { key: 'query', label: 'SQL query', type: 'expression', placeholder: 'SELECT * FROM orders WHERE id = ?' },
      { key: 'values', label: 'Query parameters (JSON array)', type: 'json', rows: 2, default: [], help: 'Bound in order for each ? placeholder in the query above.' },
    ],
  },

  elasticsearch: {
    fields: [
      { key: 'index', label: 'Index', type: 'string', placeholder: 'orders' },
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'search',
        options: [
          { value: 'search', label: 'Search' },
          { value: 'index', label: 'Index document' },
          { value: 'delete', label: 'Delete document' },
        ],
      },
      { key: 'query', label: 'Query (JSON)', type: 'json', rows: 4, default: { query: { match_all: {} } }, visibleIf: (p) => (p.action ?? 'search') === 'search' },
      { key: 'id', label: 'Document ID (optional on index, required on delete)', type: 'string', visibleIf: (p) => p.action === 'index' || p.action === 'delete' },
      { key: 'document', label: 'Document (JSON)', type: 'json', rows: 4, default: {}, visibleIf: (p) => p.action === 'index' },
    ],
  },

  pagerduty: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'triggerIncident',
        options: [
          { value: 'triggerIncident', label: 'Trigger incident' },
          { value: 'acknowledgeIncident', label: 'Acknowledge incident' },
          { value: 'resolveIncident', label: 'Resolve incident' },
          { value: 'listIncidents', label: 'List incidents' },
        ],
      },
      { key: 'summary', label: 'Summary', type: 'expression', placeholder: 'API latency spike', visibleIf: (p) => (p.action ?? 'triggerIncident') === 'triggerIncident' },
      { key: 'source', label: 'Source', type: 'string', default: 'flowforge', visibleIf: (p) => (p.action ?? 'triggerIncident') === 'triggerIncident' },
      {
        key: 'severity',
        label: 'Severity',
        type: 'enum',
        default: 'error',
        options: [
          { value: 'critical', label: 'Critical' },
          { value: 'error', label: 'Error' },
          { value: 'warning', label: 'Warning' },
          { value: 'info', label: 'Info' },
        ],
        visibleIf: (p) => (p.action ?? 'triggerIncident') === 'triggerIncident',
      },
      { key: 'dedupKey', label: 'Dedup key', type: 'string', help: 'Ties trigger/acknowledge/resolve events to the same incident.', visibleIf: (p) => ['triggerIncident', 'acknowledgeIncident', 'resolveIncident'].includes(String(p.action ?? 'triggerIncident')) },
    ],
  },

  datadog: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'submitMetric',
        options: [
          { value: 'submitMetric', label: 'Submit metric' },
          { value: 'submitLog', label: 'Submit log' },
        ],
      },
      { key: 'metricName', label: 'Metric name', type: 'string', placeholder: 'flowforge.workflow.runs', visibleIf: (p) => (p.action ?? 'submitMetric') === 'submitMetric' },
      { key: 'value', label: 'Value', type: 'number', default: 0, visibleIf: (p) => (p.action ?? 'submitMetric') === 'submitMetric' },
      { key: 'tags', label: 'Tags (JSON array)', type: 'json', rows: 2, default: [], visibleIf: (p) => (p.action ?? 'submitMetric') === 'submitMetric' },
      { key: 'message', label: 'Log message', type: 'expression', visibleIf: (p) => p.action === 'submitLog' },
      { key: 'service', label: 'Service name', type: 'string', visibleIf: (p) => p.action === 'submitLog' },
    ],
  },

  calendly: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'listEvents',
        options: [
          { value: 'listEvents', label: 'List events' },
          { value: 'getInvitee', label: 'Get invitee' },
          { value: 'cancelEvent', label: 'Cancel event' },
        ],
      },
      { key: 'userUri', label: 'User URI (optional, defaults to the authenticated user)', type: 'string', visibleIf: (p) => (p.action ?? 'listEvents') === 'listEvents' },
      { key: 'eventUuid', label: 'Event UUID', type: 'string', visibleIf: (p) => p.action === 'getInvitee' || p.action === 'cancelEvent' },
      { key: 'inviteeUuid', label: 'Invitee UUID', type: 'string', visibleIf: (p) => p.action === 'getInvitee' },
      { key: 'reason', label: 'Cancellation reason', type: 'expression', visibleIf: (p) => p.action === 'cancelEvent' },
    ],
  },

  sftp: {
    fields: [
      {
        key: 'protocol',
        label: 'Protocol',
        type: 'enum',
        default: 'sftp',
        options: [
          { value: 'sftp', label: 'SFTP' },
          { value: 'ftp', label: 'FTP' },
        ],
      },
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'list',
        options: [
          { value: 'list', label: 'List directory' },
          { value: 'upload', label: 'Upload file' },
          { value: 'download', label: 'Download file' },
        ],
      },
      { key: 'remotePath', label: 'Remote path', type: 'string', placeholder: '/uploads' },
      { key: 'content', label: 'File content', type: 'expression', visibleIf: (p) => p.action === 'upload' },
    ],
  },

  paypal: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'createOrder',
        options: [
          { value: 'createOrder', label: 'Create order' },
          { value: 'captureOrder', label: 'Capture order' },
        ],
      },
      { key: 'amount', label: 'Amount', type: 'string', placeholder: '10.00', visibleIf: (p) => (p.action ?? 'createOrder') === 'createOrder' },
      { key: 'currency', label: 'Currency', type: 'string', default: 'USD', visibleIf: (p) => (p.action ?? 'createOrder') === 'createOrder' },
      { key: 'orderId', label: 'Order ID', type: 'string', visibleIf: (p) => p.action === 'captureOrder' },
    ],
  },

  quickbooks: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'listInvoices',
        options: [
          { value: 'listInvoices', label: 'List invoices' },
          { value: 'createInvoice', label: 'Create invoice' },
          { value: 'createCustomer', label: 'Create customer' },
        ],
      },
      { key: 'query', label: 'SQL-like query', type: 'string', default: 'select * from Invoice maxresults 25', visibleIf: (p) => (p.action ?? 'listInvoices') === 'listInvoices' },
      { key: 'invoice', label: 'Invoice (JSON)', type: 'json', rows: 4, default: {}, help: 'QuickBooks Invoice object — see QuickBooks API docs.', visibleIf: (p) => p.action === 'createInvoice' },
      { key: 'customer', label: 'Customer (JSON)', type: 'json', rows: 4, default: { DisplayName: '' }, visibleIf: (p) => p.action === 'createCustomer' },
    ],
  },

  xero: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'listInvoices',
        options: [
          { value: 'listInvoices', label: 'List invoices' },
          { value: 'createInvoice', label: 'Create invoice' },
          { value: 'createContact', label: 'Create contact' },
        ],
      },
      { key: 'invoice', label: 'Invoice (JSON)', type: 'json', rows: 4, default: {}, help: 'Xero Invoice object — see Xero API docs.', visibleIf: (p) => p.action === 'createInvoice' },
      { key: 'contact', label: 'Contact (JSON)', type: 'json', rows: 3, default: { Name: '' }, visibleIf: (p) => p.action === 'createContact' },
    ],
  },

  zendesk: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'createTicket',
        options: [
          { value: 'createTicket', label: 'Create ticket' },
          { value: 'updateTicket', label: 'Update ticket' },
        ],
      },
      { key: 'subject', label: 'Subject', type: 'expression', visibleIf: (p) => (p.action ?? 'createTicket') === 'createTicket' },
      { key: 'body', label: 'Description', type: 'expression', visibleIf: (p) => (p.action ?? 'createTicket') === 'createTicket' },
      {
        key: 'priority',
        label: 'Priority',
        type: 'enum',
        default: 'normal',
        options: [
          { value: 'low', label: 'Low' },
          { value: 'normal', label: 'Normal' },
          { value: 'high', label: 'High' },
          { value: 'urgent', label: 'Urgent' },
        ],
        visibleIf: (p) => (p.action ?? 'createTicket') === 'createTicket',
      },
      { key: 'requesterEmail', label: 'Requester email (optional)', type: 'string', visibleIf: (p) => (p.action ?? 'createTicket') === 'createTicket' },
      { key: 'ticketId', label: 'Ticket ID', type: 'string', visibleIf: (p) => p.action === 'updateTicket' },
    ],
  },

  mailchimp: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'addMember',
        options: [
          { value: 'addMember', label: 'Add subscriber' },
          { value: 'listMembers', label: 'List subscribers' },
          { value: 'createCampaign', label: 'Create campaign' },
        ],
      },
      { key: 'listId', label: 'Audience/List ID', type: 'string', visibleIf: (p) => ['addMember', 'listMembers'].includes(String(p.action ?? 'addMember')) },
      { key: 'email', label: 'Email', type: 'expression', visibleIf: (p) => (p.action ?? 'addMember') === 'addMember' },
      { key: 'mergeFields', label: 'Merge fields (JSON)', type: 'json', rows: 2, default: {}, visibleIf: (p) => (p.action ?? 'addMember') === 'addMember' },
      { key: 'campaign', label: 'Campaign (JSON)', type: 'json', rows: 4, default: { type: 'regular' }, visibleIf: (p) => p.action === 'createCampaign' },
    ],
  },

  segment: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'track',
        options: [
          { value: 'track', label: 'Track event' },
          { value: 'identify', label: 'Identify user' },
          { value: 'page', label: 'Page view' },
          { value: 'group', label: 'Group' },
        ],
      },
      { key: 'userId', label: 'User ID', type: 'expression', help: 'Either User ID or Anonymous ID is required.' },
      { key: 'anonymousId', label: 'Anonymous ID (optional)', type: 'expression' },
      { key: 'event', label: 'Event name', type: 'expression', visibleIf: (p) => (p.action ?? 'track') === 'track' },
      { key: 'name', label: 'Page name', type: 'expression', visibleIf: (p) => p.action === 'page' },
      { key: 'groupId', label: 'Group ID', type: 'expression', visibleIf: (p) => p.action === 'group' },
      { key: 'traits', label: 'Traits (JSON)', type: 'json', rows: 2, default: {}, visibleIf: (p) => p.action === 'identify' },
      { key: 'properties', label: 'Properties (JSON)', type: 'json', rows: 2, default: {}, visibleIf: (p) => (p.action ?? 'track') !== 'identify' },
    ],
  },

  googleAds: {
    fields: [
      {
        key: 'query',
        label: 'GAQL query',
        type: 'text',
        placeholder: 'SELECT campaign.id, campaign.name, metrics.clicks FROM campaign WHERE segments.date DURING LAST_7_DAYS',
        help: 'Google Ads Query Language. Leave blank for a default last-7-days campaign performance query.',
      },
    ],
  },

  metaAds: {
    fields: [
      { key: 'fields', label: 'Fields', type: 'string', default: 'campaign_name,impressions,clicks,spend' },
      {
        key: 'datePreset',
        label: 'Date range',
        type: 'enum',
        default: 'last_7d',
        options: [
          { value: 'today', label: 'Today' },
          { value: 'yesterday', label: 'Yesterday' },
          { value: 'last_7d', label: 'Last 7 days' },
          { value: 'last_30d', label: 'Last 30 days' },
          { value: 'this_month', label: 'This month' },
        ],
      },
      {
        key: 'level',
        label: 'Level',
        type: 'enum',
        default: 'campaign',
        options: [
          { value: 'account', label: 'Account' },
          { value: 'campaign', label: 'Campaign' },
          { value: 'adset', label: 'Ad set' },
          { value: 'ad', label: 'Ad' },
        ],
      },
    ],
  },

  amplitude: {
    fields: [
      { key: 'eventType', label: 'Event type', type: 'expression', placeholder: 'Signed Up' },
      { key: 'userId', label: 'User ID', type: 'expression', help: 'Either User ID or Device ID is required.' },
      { key: 'deviceId', label: 'Device ID (optional)', type: 'expression' },
      { key: 'eventProperties', label: 'Event properties (JSON)', type: 'json', rows: 2, default: {} },
      { key: 'userProperties', label: 'User properties (JSON)', type: 'json', rows: 2, default: {} },
    ],
  },

  mixpanel: {
    fields: [
      { key: 'eventName', label: 'Event name', type: 'expression', placeholder: 'Signed Up' },
      { key: 'distinctId', label: 'Distinct ID', type: 'expression' },
      { key: 'properties', label: 'Properties (JSON)', type: 'json', rows: 3, default: {} },
    ],
  },

  docusign: {
    fields: [
      {
        key: 'action',
        label: 'Action',
        type: 'enum',
        default: 'sendEnvelope',
        options: [
          { value: 'sendEnvelope', label: 'Send envelope' },
          { value: 'getEnvelopeStatus', label: 'Get envelope status' },
        ],
      },
      { key: 'envelope', label: 'Envelope (JSON)', type: 'json', rows: 5, default: { emailSubject: 'Please sign', status: 'sent' }, help: 'DocuSign envelope definition — see DocuSign eSignature API docs.', visibleIf: (p) => (p.action ?? 'sendEnvelope') === 'sendEnvelope' },
      { key: 'envelopeId', label: 'Envelope ID', type: 'string', visibleIf: (p) => p.action === 'getEnvelopeStatus' },
    ],
  },
};

export function getParamSchema(nodeType: string): ParamSchema | undefined {
  return PARAM_SCHEMAS[nodeType];
}