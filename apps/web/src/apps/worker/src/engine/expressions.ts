import { randomUUID, createHash } from 'crypto';

/**
 * Minimal n8n-style expression engine.
 *
 * Supported in any string param value:
 *   {{$json.path.to.field}}        -> value from this node's resolved input
 *   {{$node["Label"].json.field}}  -> output of a previously-run node, by label
 *   {{$env.NAME}}                  -> process.env.NAME
 *   {{$workflow.id}} / {{$execution.id}}
 *   {{$now}}  -> ISO timestamp    {{$today}} -> YYYY-MM-DD
 *   {{$item.field}}                -> current item (inside forEach)
 *   {{$binary.data.mimeType}}      -> metadata (mimeType/fileName/fileSize) of binary
 *                                      attachments on the input item(s) — never the raw bytes
 *   {{$node["Label"].binary.data.fileName}} -> same, for a specific upstream node's output
 * Whole-param resolution: if the ENTIRE string is a single {{...}} expression,
 * the resolved value keeps its original type (object/array/number/etc). If it's
 * a template with surrounding text, the resolved value is stringified and spliced in.
 * Params are walked recursively (objects/arrays), so this works anywhere in
 * a node's JSON params, not just top-level strings.
 */

export interface ExpressionContext {
  json: unknown; // this node's resolved input
  env: Record<string, string | undefined>;
  workflow: { id: string };
  execution: { id: string };
  nodesByLabel: Record<string, { json: unknown; binary?: unknown }>;
  item?: unknown; // current loop item, if inside a forEach
  /** Binary metadata (mimeType/fileName/fileSize — never the raw base64) for the current input item(s). */
  binary?: unknown;
}

const EXPR_RE = /\{\{\s*([\s\S]+?)\s*\}\}/g;

function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((acc, key) => (acc == null ? undefined : (acc as Record<string, unknown>)[key]), obj);
}

function evalExpr(expr: string, ctx: ExpressionContext): unknown {
  const trimmed = expr.trim();

  if (trimmed === '$now') return new Date().toISOString();
  if (trimmed === '$today') return new Date().toISOString().slice(0, 10);
  if (trimmed === '$workflow.id') return ctx.workflow.id;
  if (trimmed === '$execution.id') return ctx.execution.id;

  let m = trimmed.match(/^\$json\.?(.*)$/);
  if (m) return getPath(ctx.json, m[1]);

  m = trimmed.match(/^\$item\.?(.*)$/);
  if (m) return getPath(ctx.item, m[1]);

  m = trimmed.match(/^\$binary\.?(.*)$/);
  if (m) return getPath(ctx.binary, m[1]);

  m = trimmed.match(/^\$env\.(.+)$/);
  if (m) return ctx.env[m[1]];

  m = trimmed.match(/^\$node\["([^"]+)"\]\.json\.?(.*)$/);
  if (m) {
    const nodeOutput = ctx.nodesByLabel[m[1]];
    return nodeOutput ? getPath(nodeOutput.json, m[2]) : undefined;
  }

  m = trimmed.match(/^\$node\["([^"]+)"\]\.binary\.?(.*)$/);
  if (m) {
    const nodeOutput = ctx.nodesByLabel[m[1]];
    return nodeOutput ? getPath(nodeOutput.binary, m[2]) : undefined;
  }

  m = trimmed.match(/^\$fn\.(\w+)\.(\w+)\((.*)\)$/s);
  if (m) return callHelper(m[1], m[2], m[3], ctx);

  return undefined; // unknown expression -> leave blank rather than throw
}

/**
 * Helper function library, invoked as {{$fn.<namespace>.<fn>(args)}}.
 * Args are comma-separated and each arg is itself resolved as either a
 * nested expression (starts with $), a JSON literal (numbers/quoted
 * strings/true/false/null), or treated as a plain string.
 */
function parseArgs(raw: string, ctx: ExpressionContext): unknown[] {
  if (!raw.trim()) return [];
  return raw.split(',').map((part) => {
    const arg = part.trim();
    if (arg.startsWith('$')) return evalExpr(arg, ctx);
    if (/^-?\d+(\.\d+)?$/.test(arg)) return Number(arg);
    if (arg === 'true') return true;
    if (arg === 'false') return false;
    if (arg === 'null') return null;
    if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
      return arg.slice(1, -1);
    }
    return arg;
  });
}

function callHelper(namespace: string, fn: string, rawArgs: string, ctx: ExpressionContext): unknown {
  const args = parseArgs(rawArgs, ctx);
  switch (namespace) {
    case 'date':
      return dateHelpers(fn, args);
    case 'string':
      return stringHelpers(fn, args);
    case 'math':
      return mathHelpers(fn, args);
    case 'random':
      return randomHelpers(fn, args);
    case 'hash':
      return hashHelpers(fn, args);
    case 'json':
      return jsonHelpers(fn, args);
    default:
      return undefined;
  }
}

function dateHelpers(fn: string, args: unknown[]): unknown {
  const d = args[0] != null ? new Date(args[0] as string | number) : new Date();
  switch (fn) {
    case 'format': {
      const fmt = String(args[1] ?? 'YYYY-MM-DD');
      const pad = (n: number) => String(n).padStart(2, '0');
      return fmt
        .replace('YYYY', String(d.getFullYear()))
        .replace('MM', pad(d.getMonth() + 1))
        .replace('DD', pad(d.getDate()))
        .replace('HH', pad(d.getHours()))
        .replace('mm', pad(d.getMinutes()))
        .replace('ss', pad(d.getSeconds()));
    }
    case 'addDays': {
      const copy = new Date(d);
      copy.setDate(copy.getDate() + Number(args[1] ?? 0));
      return copy.toISOString();
    }
    case 'addHours': {
      const copy = new Date(d);
      copy.setHours(copy.getHours() + Number(args[1] ?? 0));
      return copy.toISOString();
    }
    case 'diffDays': {
      const other = new Date(args[1] as string | number);
      return Math.round((d.getTime() - other.getTime()) / 86400000);
    }
    case 'iso':
      return d.toISOString();
    case 'unix':
      return Math.floor(d.getTime() / 1000);
    case 'dayOfWeek':
      return d.getDay();
    default:
      return undefined;
  }
}

function stringHelpers(fn: string, args: unknown[]): unknown {
  const s = String(args[0] ?? '');
  switch (fn) {
    case 'upper':
      return s.toUpperCase();
    case 'lower':
      return s.toLowerCase();
    case 'trim':
      return s.trim();
    case 'slice':
      return s.slice(Number(args[1] ?? 0), args[2] != null ? Number(args[2]) : undefined);
    case 'replace':
      return s.split(String(args[1] ?? '')).join(String(args[2] ?? ''));
    case 'split':
      return s.split(String(args[1] ?? ','));
    case 'includes':
      return s.includes(String(args[1] ?? ''));
    case 'padStart':
      return s.padStart(Number(args[1] ?? 0), String(args[2] ?? ' '));
    case 'length':
      return s.length;
    case 'capitalize':
      return s.charAt(0).toUpperCase() + s.slice(1);
    default:
      return undefined;
  }
}

function mathHelpers(fn: string, args: unknown[]): unknown {
  const nums = args.map(Number);
  switch (fn) {
    case 'round':
      return Math.round(nums[0]);
    case 'floor':
      return Math.floor(nums[0]);
    case 'ceil':
      return Math.ceil(nums[0]);
    case 'abs':
      return Math.abs(nums[0]);
    case 'max':
      return Math.max(...nums);
    case 'min':
      return Math.min(...nums);
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'avg':
      return nums.reduce((a, b) => a + b, 0) / (nums.length || 1);
    case 'random':
      return Math.random();
    default:
      return undefined;
  }
}

function randomHelpers(fn: string, args: unknown[] = []): unknown {
  switch (fn) {
    case 'uuid':
      return randomUUID();
    case 'int': {
      const min = args[0] !== undefined ? Number(args[0]) : 0;
      const max = args[1] !== undefined ? Number(args[1]) : 1_000_000;
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    default:
      return undefined;
  }
}

function hashHelpers(fn: string, args: unknown[]): unknown {
  const input = String(args[0] ?? '');
  switch (fn) {
    case 'sha256':
      return createHash('sha256').update(input).digest('hex');
    case 'md5':
      return createHash('md5').update(input).digest('hex');
    case 'base64encode':
      return Buffer.from(input, 'utf-8').toString('base64');
    case 'base64decode':
      return Buffer.from(input, 'base64').toString('utf-8');
    default:
      return undefined;
  }
}

function jsonHelpers(fn: string, args: unknown[]): unknown {
  switch (fn) {
    case 'parse':
      try {
        return JSON.parse(String(args[0] ?? 'null'));
      } catch {
        return null;
      }
    case 'stringify':
      return JSON.stringify(args[0]);
    default:
      return undefined;
  }
}

function resolveString(value: string, ctx: ExpressionContext): unknown {
  const matches = [...value.matchAll(EXPR_RE)];
  if (matches.length === 1 && matches[0][0] === value.trim()) {
    // Whole string is a single expression -> preserve type.
    return evalExpr(matches[0][1], ctx);
  }
  if (matches.length === 0) return value;
  return value.replace(EXPR_RE, (_all, expr) => {
    const resolved = evalExpr(expr, ctx);
    return resolved === undefined || resolved === null
      ? ''
      : typeof resolved === 'string'
        ? resolved
        : JSON.stringify(resolved);
  });
}

export function resolveExpressions<T>(value: T, ctx: ExpressionContext): T {
  if (typeof value === 'string') return resolveString(value, ctx) as T;
  if (Array.isArray(value)) return value.map((v) => resolveExpressions(v, ctx)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveExpressions(v, ctx);
    }
    return out as T;
  }
  return value;
}
