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
    fields: [
      { key: 'field', label: 'Field (dot path)', type: 'string', placeholder: 'amount' },
      {
        key: 'operator',
        label: 'Operator',
        type: 'enum',
        default: 'equals',
        options: [
          { value: 'equals', label: 'Equals' },
          { value: 'notEquals', label: 'Not equals' },
          { value: 'contains', label: 'Contains' },
          { value: 'greaterThan', label: 'Greater than' },
          { value: 'lessThan', label: 'Less than' },
          { value: 'exists', label: 'Exists' },
        ],
      },
      { key: 'value', label: 'Value', type: 'expression', visibleIf: (p) => p.operator !== 'exists' },
    ],
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
};

export function getParamSchema(nodeType: string): ParamSchema | undefined {
  return PARAM_SCHEMAS[nodeType];
}
