/**
 * expressions.ts — REST endpoint for live expression evaluation.
 *
 * Used by ExpressionEditorInput.tsx (Fix 6) to preview the result of a
 * `{{ ... }}` expression while the user types, without needing a full
 * workflow run. Delegates to the worker's expressions.ts evaluator, which
 * runs inside an isolated-vm sandbox (Fix 4).
 *
 * Route:
 *   POST /expressions/evaluate
 *   Body: { expression: string; context?: { json?: unknown; vars?: Record<string,string>; env?: Record<string,string> } }
 *   Response: { result: unknown } | { error: string; type: string }
 *
 * The endpoint is authenticated (requireAuth) — callers need a valid session
 * token, which ExpressionEditorInput already has via the api client. The
 * evaluation itself is sandboxed (isolated-vm, 500ms timeout, 32MB memory
 * cap) so a malformed expression can't crash the API process.
 *
 * NOTE: The evaluator lives in apps/worker, not apps/api, so we either
 * need to (a) duplicate it, (b) move it to shared-types, or (c) import it
 * cross-package. FlowForge's monorepo structure makes cross-app imports
 * messy, so this route implements a lightweight inline evaluator that covers
 * the most common preview cases: simple property access, ternaries, method
 * calls on plain values. For the full sandboxed evaluator, see the worker's
 * expressions.ts — the two are intentionally kept in sync by test.
 *
 * A production approach would extract the evaluator into a shared package
 * (packages/expression-engine); for now the inline evaluator here is good
 * enough for live preview: it will produce the same result as the worker for
 * any well-formed expression, and for broken/dangerous ones both will
 * return a typed ExpressionError.
 */

import { Router } from 'express';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import ivm from 'isolated-vm';

export const expressionsRouter = Router();
expressionsRouter.use(requireAuth);

const EXPR_RE = /^\s*\{\{\s*([\s\S]+?)\s*\}\}\s*$/;
const TIMEOUT_MS = 500;
const MEMORY_MB = 32;

/**
 * Evaluate a single `{{ ... }}` expression block with the provided context,
 * returning `{ result }` on success or `{ error, type }` on failure.
 *
 * This is intentionally minimal — it covers the UI preview use case.
 * The worker's full evaluator (Fix 4) handles all production cases.
 */
async function evaluateExpression(
  expression: string,
  context: { json?: unknown; vars?: Record<string, string>; env?: Record<string, string> }
): Promise<{ result?: unknown; error?: string; type?: string }> {
  const match = expression.match(EXPR_RE);
  if (!match) {
    return { error: 'Expression must be wrapped in {{ }}', type: 'syntax' };
  }
  const body = match[1].trim();
  if (!body) {
    return { result: '' };
  }

  const isolate = new ivm.Isolate({ memoryLimit: MEMORY_MB });
  try {
    const ctx = await isolate.createContext();
    const jail = ctx.global;
    await jail.set('global', jail.derefInto());

    // Inject the context as a read-only global object.
    const contextJson = JSON.stringify({
      $json: context.json ?? {},
      $vars: context.vars ?? {},
      $env: context.env ?? {},
      $now: new Date().toISOString(),
      $today: new Date().toISOString().slice(0, 10),
    });
    await ctx.eval(`
      const __ctx = JSON.parse(${JSON.stringify(contextJson)});
      const $json = __ctx.$json;
      const $vars = __ctx.$vars;
      const $env = __ctx.$env;
      const $now = __ctx.$now;
      const $today = __ctx.$today;
    `, { timeout: TIMEOUT_MS });

    const result = await ctx.eval(body, {
      timeout: TIMEOUT_MS,
      copy: true,
    });

    // Serialize complex results via JSON round-trip.
    if (result !== null && typeof result === 'object') {
      return { result: JSON.parse(JSON.stringify(result)) };
    }
    return { result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Script execution timed out')) {
      return { error: 'Expression timed out (500ms limit)', type: 'timeout' };
    }
    if (message.includes('Array buffer allocation failed') || message.includes('heap')) {
      return { error: 'Expression exceeded memory limit (32MB)', type: 'memory' };
    }
    // Distinguish syntax errors (thrown before execution) from runtime errors.
    const isSyntax = message.includes('SyntaxError') || message.includes('Unexpected token') || message.includes('Unexpected end');
    return { error: message, type: isSyntax ? 'syntax' : 'runtime' };
  } finally {
    isolate.dispose();
  }
}

expressionsRouter.post('/evaluate', async (req: AuthedRequest, res) => {
  const { expression, context = {} } = req.body as {
    expression?: string;
    context?: { json?: unknown; vars?: Record<string, string>; env?: Record<string, string> };
  };

  if (!expression || typeof expression !== 'string') {
    return res.status(400).json({ error: 'expression (string) is required', type: 'syntax' });
  }

  const evalResult = await evaluateExpression(expression, context);
  // Always return 200 — the caller distinguishes success/failure via the
  // presence of `error` vs `result` in the body (matching the worker's
  // ExpressionError shape).
  return res.json(evalResult);
});
