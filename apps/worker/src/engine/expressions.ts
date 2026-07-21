import ivm from 'isolated-vm';
import { randomUUID, createHash } from 'crypto';

/**
 * n8n-style expression engine — real sandboxed JavaScript, not a regex
 * whitelist.
 *
 * Any string param value may contain one or more `{{ ... }}` blocks. The
 * content of each block is evaluated as an actual JavaScript expression
 * inside a fresh `isolated-vm` isolate (the same sandbox technology the
 * Code node uses), with these read-only globals available:
 *
 *   $json           -> this node's resolved input
 *   $item           -> current loop item, if inside a forEach
 *   $node["Label"] -> { json, binary } of a previously-run node, resolved
 *                      by display label OR stable node id (label first)
 *   $env.NAME       -> process.env.NAME
 *   $vars.NAME      -> global/workspace Variables store
 *   $staticData     -> this workflow's persisted static-data blob
 *   $workflow.id / $execution.id
 *   $now / $today   -> current ISO timestamp / YYYY-MM-DD
 *   $binary         -> metadata (mimeType/fileName/fileSize) for the
 *                      current input item(s) — never raw bytes
 *   $trigger        -> the original trigger payload (chatTrigger: { sessionId, message, attachments },
 *                      webhook: { body, headers, query }). Safe to use from ANY downstream node
 *                      regardless of chain length — no need to know the trigger node label.
 *   $fn.<namespace>.<fn>(...) -> the same helper library as before
 *      (date/string/math/random/hash/json), now callable as ordinary
 *      functions inside real JS rather than parsed positionally.
 *
 * Because it's real JS, ternaries, method calls, arithmetic, template
 * literals, arbitrary chaining — anything valid inside a single
 * expression — now works, instead of silently resolving to `undefined`
 * outside a fixed set of regex-matched shapes.
 *
 * Whole-param resolution: if the ENTIRE string is a single {{...}}
 * expression, the resolved value keeps its original type (object/array/
 * number/etc). If it's a template with surrounding text, the resolved
 * value is stringified and spliced in.
 *
 * Params are walked recursively (objects/arrays), so this works anywhere
 * in a node's JSON params, not just top-level strings.
 */

export interface ExpressionContext {
  json: unknown; // this node's resolved input
  env: Record<string, string | undefined>;
  workflow: { id: string };
  execution: { id: string };
  /** Keyed by node display label (n8n's primary `$node[...]` lookup key). */
  nodesByLabel: Record<string, { json: unknown; binary?: unknown }>;
  /**
   * Keyed by stable node id. `$node[...]` checks label first, then id, so
   * a duplicate-label collision (frontend now auto-suffixes on
   * create/rename, but pre-existing workflows may still have one) can be
   * disambiguated by id, and expressions authored against ids keep
   * working even if a node is later relabeled.
   */
  nodesById: Record<string, { json: unknown; binary?: unknown }>;
  /** Global/workspace Variables store, keyed by name — see {{$vars.NAME}}. */
  vars: Record<string, string>;
  /** This workflow's persisted static-data blob ($getWorkflowStaticData() equivalent) — see {{$staticData.KEY}}. */
  staticData: Record<string, unknown>;
  item?: unknown; // current loop item, if inside a forEach
  /** Binary metadata (mimeType/fileName/fileSize — never the raw base64) for the current input item(s). */
  binary?: unknown;
  /** The original trigger payload that started this run (chatTrigger, webhook, etc).
   *  Access via $trigger.sessionId, $trigger.message, etc — works from any node regardless of chain length. */
  trigger?: unknown;
}

const EXPR_RE = /\{\{\s*([\s\S]+?)\s*\}\}/g;

export type ExpressionErrorType = 'timeout' | 'memory' | 'syntax' | 'security' | 'runtime';

export class ExpressionError extends Error {
  type: ExpressionErrorType;
  expression: string;
  constructor(type: ExpressionErrorType, expression: string, message: string) {
    super(message);
    this.name = 'ExpressionError';
    this.type = type;
    this.expression = expression;
  }
}

const EXPRESSION_TIMEOUT_MS = 500;
const EXPRESSION_MEMORY_LIMIT_MB = 32;

// ---- $fn.<namespace>.<fn>(...) helper library — unchanged behavior, now
// invoked as real function calls from inside the sandbox rather than
// parsed out of a fixed `$fn.ns.fn(args)` regex shape. ----

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

function randomHelpers(fn: string): unknown {
  switch (fn) {
    case 'uuid':
      return randomUUID();
    case 'int':
      return Math.floor(Math.random() * 1_000_000);
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

function callHelper(namespace: string, fn: string, args: unknown[]): unknown {
  switch (namespace) {
    case 'date':
      return dateHelpers(fn, args);
    case 'string':
      return stringHelpers(fn, args);
    case 'math':
      return mathHelpers(fn, args);
    case 'random':
      return randomHelpers(fn);
    case 'hash':
      return hashHelpers(fn, args);
    case 'json':
      return jsonHelpers(fn, args);
    default:
      return undefined;
  }
}

/**
 * Resolves `$node["Label"]` (or, if no label matches, by node id) by name
 * lookup done OUTSIDE the isolate (plain JS object access), then hands
 * the result in as a plain JSON-serializable value — no live references
 * cross the isolate boundary.
 */
function resolveNode(ctx: ExpressionContext, name: string): { json: unknown; binary?: unknown } | undefined {
  return ctx.nodesByLabel[name] ?? ctx.nodesById[name];
}

/**
 * Evaluates a single `{{ ... }}` expression body as real JavaScript
 * inside a fresh isolated-vm context. Throws a typed `ExpressionError` on
 * timeout, out-of-memory, syntax error, sandbox security violation, or
 * any runtime error the expression itself throws — callers attach this
 * to the node's run result instead of silently resolving to `undefined`.
 */
async function evalExprSandboxed(expr: string, ctx: ExpressionContext): Promise<unknown> {
  const isolate = new ivm.Isolate({ memoryLimit: EXPRESSION_MEMORY_LIMIT_MB });
  try {
    const context = await isolate.createContext();
    const jail = context.global;
    await jail.set('global', jail.derefInto());

    // All context data is bridged in as JSON — no live object graph, no
    // prototype access to the outer realm, matching n8n's
    // expression-sandboxing.ts approach (block `with`, prototype access,
    // `this`, reserved-name collisions) via isolation rather than by
    // pattern-matching the input.
    const dataJson = JSON.stringify({
      json: ctx.json ?? null,
      item: ctx.item ?? null,
      env: ctx.env ?? {},
      vars: ctx.vars ?? {},
      staticData: ctx.staticData ?? {},
      binary: ctx.binary ?? null,
      workflow: ctx.workflow,
      execution: ctx.execution,
      trigger: ctx.trigger ?? {},
    });

    await jail.set(
      '__resolveNode',
      new ivm.Reference((name: string) => {
        const resolved = resolveNode(ctx, name);
        return resolved === undefined ? 'null' : JSON.stringify(resolved);
      })
    );
    await jail.set(
      '__callHelper',
      new ivm.Reference((namespace: string, fn: string, argsJson: string) => {
        let args: unknown[] = [];
        try {
          args = JSON.parse(argsJson);
        } catch {
          // malformed args -> treat as empty
        }
        const result = callHelper(namespace, fn, args);
        return JSON.stringify(result === undefined ? null : result);
      })
    );

    const wrapped = `
      (function() {
        const __data = JSON.parse(${JSON.stringify(dataJson)});
        const $json = __data.json;
        const $item = __data.item;
        const $env = __data.env;
        const $vars = __data.vars;
        const $staticData = __data.staticData;
        const $binary = __data.binary;
        const $workflow = __data.workflow;
        const $execution = __data.execution;
        const $trigger = __data.trigger;
        const $now = new Date().toISOString();
        const $today = new Date().toISOString().slice(0, 10);
        const $node = new Proxy({}, {
          get(_t, name) {
            if (typeof name !== 'string') return undefined;
            return JSON.parse(__resolveNode.applySync(undefined, [name]));
          }
        });
        const $fn = new Proxy({}, {
          get(_t, namespace) {
            return new Proxy({}, {
              get(_t2, fnName) {
                return function(...args) {
                  return JSON.parse(__callHelper.applySync(undefined, [namespace, fnName, JSON.stringify(args)]));
                };
              }
            });
          }
        });
        const result = (${expr}
        );
        return JSON.stringify(result === undefined ? null : result);
      })()
    `;

    let script: ivm.Script;
    try {
      script = await isolate.compileScript(wrapped);
    } catch (err) {
      throw new ExpressionError('syntax', expr, err instanceof Error ? err.message : String(err));
    }

    let resultJson: string;
    try {
      resultJson = await script.run(context, { timeout: EXPRESSION_TIMEOUT_MS });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/timed out/i.test(message)) throw new ExpressionError('timeout', expr, message);
      if (/isolate is not able to allocate more memory|memory limit/i.test(message)) {
        throw new ExpressionError('memory', expr, message);
      }
      if (/prototype|constructor\.constructor|with statement|reserved/i.test(message)) {
        throw new ExpressionError('security', expr, message);
      }
      throw new ExpressionError('runtime', expr, message);
    }

    return JSON.parse(resultJson);
  } finally {
    isolate.dispose();
  }
}

export interface ResolveOptions {
  /** Collects `{ param, message, type }` for every expression that failed, instead of throwing on the first one. */
  onError?: (err: { param: string; message: string; type: ExpressionErrorType }) => void;
}

async function resolveString(value: string, ctx: ExpressionContext, paramPath: string, opts?: ResolveOptions): Promise<unknown> {
  const matches = [...value.matchAll(EXPR_RE)];
  if (matches.length === 0) return value;

  if (matches.length === 1 && matches[0][0] === value.trim()) {
    // Whole string is a single expression -> preserve type.
    try {
      return await evalExprSandboxed(matches[0][1], ctx);
    } catch (err) {
      if (err instanceof ExpressionError) {
        opts?.onError?.({ param: paramPath, message: err.message, type: err.type });
        return undefined;
      }
      throw err;
    }
  }

  // Template with surrounding text: resolve each block in turn, stringify
  // and splice. Sequential (not Promise.all) — cost is dominated by
  // isolate startup either way, and sequential keeps per-block error
  // reporting simple and ordered.
  let out = '';
  let lastIndex = 0;
  for (const m of matches) {
    out += value.slice(lastIndex, m.index);
    try {
      const resolved = await evalExprSandboxed(m[1], ctx);
      out += resolved === undefined || resolved === null ? '' : typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
    } catch (err) {
      if (err instanceof ExpressionError) {
        opts?.onError?.({ param: paramPath, message: err.message, type: err.type });
        // leave this block blank; other blocks in the same template still resolve
      } else {
        throw err;
      }
    }
    lastIndex = (m.index ?? 0) + m[0].length;
  }
  out += value.slice(lastIndex);
  return out;
}

export async function resolveExpressions<T>(value: T, ctx: ExpressionContext, opts?: ResolveOptions, paramPath = ''): Promise<T> {
  if (typeof value === 'string') return (await resolveString(value, ctx, paramPath, opts)) as T;
  if (Array.isArray(value)) {
    return (await Promise.all(value.map((v, i) => resolveExpressions(v, ctx, opts, `${paramPath}[${i}]`)))) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = await resolveExpressions(v, ctx, opts, paramPath ? `${paramPath}.${k}` : k);
    }
    return out as T;
  }
  return value;
}
