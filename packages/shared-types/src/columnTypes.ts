// ---------------------------------------------------------------------------
// Data Table column types
// ---------------------------------------------------------------------------
// The DB stores every row as JSONB (see DataTable/DataTableRow), so a column
// "type" is purely a UI + validation hint, not a DB-enforced constraint.
// This catalog is the single source of truth for the set of types offered
// when creating/editing a Data Table column, shared by the API (zod schema
// + coercion on write) and the web app (column-type picker, cell renderer).

export type ColumnTypeId =
  | 'string'
  | 'text'
  | 'number'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'time'
  | 'json'
  | 'array'
  | 'email'
  | 'url'
  | 'phone'
  | 'uuid'
  | 'select'
  | 'multiSelect'
  | 'color'
  | 'currency'
  | 'percent'
  | 'richText'
  | 'ipAddress'
  | 'geoPoint'
  | 'duration'
  | 'file'
  | 'secret';

export interface ColumnTypeDefinition {
  id: ColumnTypeId;
  label: string;
  /** Short human description shown in the column-type picker. */
  description: string;
  /** Example value shown in docs / the seeded showcase table. */
  example: unknown;
  /** Underlying JSON representation this type is stored as. */
  storage: 'string' | 'number' | 'boolean' | 'object' | 'array';
  /** Regex used for lightweight client-side validation, where applicable. */
  pattern?: string;
}

export const COLUMN_TYPES: ColumnTypeDefinition[] = [
  { id: 'string', label: 'Single line text', description: 'Short free text, e.g. a name or title.', example: 'Ada Lovelace', storage: 'string' },
  { id: 'text', label: 'Long text', description: 'Multi-paragraph free text.', example: 'Notes about this record spanning several sentences.', storage: 'string' },
  { id: 'richText', label: 'Rich text (HTML)', description: 'Formatted text stored as HTML/Markdown.', example: '<p>Formatted <b>note</b></p>', storage: 'string' },
  { id: 'number', label: 'Number', description: 'Any numeric value, integer or decimal.', example: 42.5, storage: 'number' },
  { id: 'integer', label: 'Integer', description: 'Whole number only, no decimals.', example: 42, storage: 'number', pattern: '^-?\\d+$' },
  { id: 'float', label: 'Decimal', description: 'Floating point number.', example: 3.14159, storage: 'number' },
  { id: 'boolean', label: 'Boolean', description: 'True/false toggle.', example: true, storage: 'boolean' },
  { id: 'date', label: 'Date', description: 'Calendar date, no time component.', example: '2026-07-19', storage: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  { id: 'datetime', label: 'Date & time', description: 'ISO 8601 timestamp.', example: '2026-07-19T14:30:00Z', storage: 'string' },
  { id: 'time', label: 'Time', description: 'Time of day, no date.', example: '14:30:00', storage: 'string', pattern: '^\\d{2}:\\d{2}(:\\d{2})?$' },
  { id: 'duration', label: 'Duration (seconds)', description: 'Elapsed time in seconds.', example: 3600, storage: 'number' },
  { id: 'json', label: 'JSON object', description: 'Arbitrary nested JSON object.', example: { nested: { ok: true } }, storage: 'object' },
  { id: 'array', label: 'List', description: 'Ordered list of values.', example: ['a', 'b', 'c'], storage: 'array' },
  { id: 'email', label: 'Email', description: 'Email address, validated client-side.', example: 'ada@example.com', storage: 'string', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
  { id: 'url', label: 'URL', description: 'Web address.', example: 'https://flowforge.dev', storage: 'string', pattern: '^https?://' },
  { id: 'phone', label: 'Phone number', description: 'Phone number, any format.', example: '+92 300 1234567', storage: 'string' },
  { id: 'uuid', label: 'UUID', description: 'Universally unique identifier.', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6', storage: 'string', pattern: '^[0-9a-f-]{36}$' },
  { id: 'select', label: 'Single select', description: 'One value from a fixed set of options.', example: 'in_progress', storage: 'string' },
  { id: 'multiSelect', label: 'Multi select', description: 'Zero or more values from a fixed set of options.', example: ['urgent', 'billing'], storage: 'array' },
  { id: 'color', label: 'Color', description: 'Hex color value.', example: '#3B82F6', storage: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
  { id: 'currency', label: 'Currency (USD)', description: 'Monetary amount in the smallest reasonable precision.', example: 1999.0, storage: 'number' },
  { id: 'percent', label: 'Percent', description: 'Percentage value, 0-100.', example: 87.5, storage: 'number' },
  { id: 'ipAddress', label: 'IP address', description: 'IPv4 or IPv6 address.', example: '192.168.1.14', storage: 'string' },
  { id: 'geoPoint', label: 'Geo point', description: 'Latitude/longitude pair.', example: { lat: 24.8607, lng: 67.0011 }, storage: 'object' },
  { id: 'file', label: 'File reference', description: 'Reference to a stored/attached file (name + URL).', example: { fileName: 'invoice.pdf', url: 'https://files.flowforge.dev/invoice.pdf' }, storage: 'object' },
  { id: 'secret', label: 'Secret (masked)', description: 'Sensitive value, masked in the UI after saving.', example: '••••••••', storage: 'string' },
];

export const COLUMN_TYPE_IDS = COLUMN_TYPES.map((t) => t.id);

export function getColumnType(id: string): ColumnTypeDefinition | undefined {
  return COLUMN_TYPES.find((t) => t.id === id);
}

/** Loosely coerces a raw cell value to its column type's storage shape. Never throws — falls back to the raw value so a bad cell doesn't block the whole row write. */
export function coerceColumnValue(typeId: string, raw: unknown): unknown {
  const type = getColumnType(typeId);
  if (!type || raw === '' || raw === null || raw === undefined) return raw;
  try {
    switch (type.storage) {
      case 'number':
        return typeof raw === 'number' ? raw : Number(raw);
      case 'boolean':
        return typeof raw === 'boolean' ? raw : raw === 'true' || raw === '1' || raw === 1;
      case 'object':
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      case 'array':
        return typeof raw === 'string' ? (raw.trim().startsWith('[') ? JSON.parse(raw) : raw.split(',').map((s) => s.trim())) : raw;
      default:
        return raw;
    }
  } catch {
    return raw;
  }
}
