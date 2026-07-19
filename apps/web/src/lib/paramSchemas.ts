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

export type FieldType = 'string' | 'expression' | 'text' | 'number' | 'boolean' | 'enum' | 'object' | 'array' | 'json';

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
  | (FieldBase & { type: 'string' | 'expression' | 'text' })
  | (FieldBase & { type: 'number'; min?: number; max?: number; step?: number })
  | (FieldBase & { type: 'boolean' })
  | (FieldBase & { type: 'enum'; options: EnumOption[] })
  | (FieldBase & { type: 'object' }) // flat string-value key/value editor
  | (FieldBase & { type: 'array'; itemFields: ParamField[]; itemLabel?: string }) // repeatable rows of objects
  | (FieldBase & { type: 'json'; rows?: number });

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
};

export function getParamSchema(nodeType: string): ParamSchema | undefined {
  return PARAM_SCHEMAS[nodeType];
}