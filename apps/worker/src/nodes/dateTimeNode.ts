import { registerNode } from './types';
import type { NodePlugin } from './types';
import { getByPath, setByPath } from '../engine/jsonPath';

/**
 * Date & Time — n8n/Make's dedicated date node. Previously this was only
 * reachable via the Code node's raw JS `Date`; this gives it a real
 * point-and-click form (see paramSchemas.ts).
 *
 * ITEM-AWARE: runs once per item.
 *
 * params:
 *   operation: 'format' | 'addSubtract' | 'difference' | 'now'   default 'format'
 *   sourceField?: string        dot-path to read the date from (ISO string, epoch ms, or
 *                                already a Date-parseable value). Ignored for 'now'.
 *   destinationField?: string  where to write the result (default 'date' for format/now,
 *                                'result' for addSubtract/difference)
 *   format?: string             'iso' | 'unix' | 'unixMs' | 'date' (YYYY-MM-DD) |
 *                                'time' (HH:mm:ss) | 'locale' — used by 'format'
 *   amount?: number             used by 'addSubtract', can be negative
 *   unit?: 'seconds'|'minutes'|'hours'|'days'|'weeks'|'months'|'years'   used by
 *                                'addSubtract'/'difference'
 *   compareField?: string       second date's dot-path, used by 'difference'
 */
const MS_PER_UNIT: Record<string, number> = {
  seconds: 1000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 604_800_000,
};

function parseInputDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    // bare numeric string -> treat as epoch ms, else let Date parse ISO/etc.
    if (/^\d+$/.test(value.trim())) return new Date(Number(value));
    return new Date(value);
  }
  throw new Error(`Date & Time node: could not parse "${JSON.stringify(value)}" as a date`);
}

function formatDate(d: Date, format: string): unknown {
  if (Number.isNaN(d.getTime())) throw new Error('Date & Time node: invalid date');
  switch (format) {
    case 'unix':
      return Math.floor(d.getTime() / 1000);
    case 'unixMs':
      return d.getTime();
    case 'date':
      return d.toISOString().slice(0, 10);
    case 'time':
      return d.toISOString().slice(11, 19);
    case 'locale':
      return d.toLocaleString();
    case 'iso':
    default:
      return d.toISOString();
  }
}

function addSubtract(d: Date, amount: number, unit: string): Date {
  const out = new Date(d.getTime());
  if (unit === 'months') {
    out.setMonth(out.getMonth() + amount);
    return out;
  }
  if (unit === 'years') {
    out.setFullYear(out.getFullYear() + amount);
    return out;
  }
  const msPerUnit = MS_PER_UNIT[unit];
  if (!msPerUnit) throw new Error(`Date & Time node: unknown unit "${unit}"`);
  return new Date(out.getTime() + amount * msPerUnit);
}

function difference(a: Date, b: Date, unit: string): number {
  const diffMs = b.getTime() - a.getTime();
  if (unit === 'months') {
    return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  }
  if (unit === 'years') {
    return b.getFullYear() - a.getFullYear();
  }
  const msPerUnit = MS_PER_UNIT[unit] ?? MS_PER_UNIT.days;
  return diffMs / msPerUnit;
}

export const dateTimeNode: NodePlugin = {
  type: 'dateTime',
  async execute({ items, params }) {
    const operation = String(params.operation ?? 'format');
    const sourceField = params.sourceField ? String(params.sourceField) : '';
    const format = String(params.format ?? 'iso');
    const unit = String(params.unit ?? 'days');
    const amount = Number(params.amount ?? 0);
    const compareField = params.compareField ? String(params.compareField) : '';

    const sourceItems = items.length > 0 ? items : [{ json: {} }];

    const outItems = sourceItems.map((item, i) => {
      const outJson: Record<string, unknown> = { ...item.json };
      let result: unknown;
      let destinationField = params.destinationField ? String(params.destinationField) : '';

      if (operation === 'now') {
        result = formatDate(new Date(), format);
        destinationField = destinationField || 'date';
      } else if (operation === 'format') {
        const raw = sourceField ? getByPath(item.json, sourceField) : item.json;
        result = formatDate(parseInputDate(raw), format);
        destinationField = destinationField || 'date';
      } else if (operation === 'addSubtract') {
        const raw = sourceField ? getByPath(item.json, sourceField) : item.json;
        const shifted = addSubtract(parseInputDate(raw), amount, unit);
        result = formatDate(shifted, format);
        destinationField = destinationField || 'result';
      } else if (operation === 'difference') {
        const raw = sourceField ? getByPath(item.json, sourceField) : item.json;
        const rawCompare = compareField ? getByPath(item.json, compareField) : undefined;
        if (rawCompare === undefined) {
          throw new Error('Date & Time node: "difference" requires compareField to be set');
        }
        result = difference(parseInputDate(raw), parseInputDate(rawCompare), unit);
        destinationField = destinationField || 'result';
      } else {
        throw new Error(`Date & Time node: unknown operation "${operation}"`);
      }

      setByPath(outJson, destinationField, result);
      return { json: outJson, binary: item.binary, pairedItem: item.pairedItem ?? { item: i } };
    });

    return { items: outItems };
  },
};

registerNode(dateTimeNode);
