/**
 * Scoring functions for the "Run tests" action (WorkflowTestsPage.tsx).
 * Each scorer takes the workflow's actual output for a test case and its
 * saved `expectedOutput`, and returns a pass/fail verdict plus enough
 * detail (a diff or a score) for the UI to explain why.
 *
 * Deliberately a plain function map (not a class hierarchy) so a new
 * scorer is just one more entry — this is the "leave room for a pluggable
 * scorer function" hook called out in the Phase 9 spec. The `similarity`
 * scorer in particular is what makes this usable as a lightweight AI
 * evaluation mode for agent/openai/RAG nodes, whose output text is rarely
 * byte-for-byte identical between runs.
 */

export interface ScoreResult {
  pass: boolean;
  /** 0-1 for similarity-style scorers; omitted for exact/structural scorers (those are just pass/fail). */
  score?: number;
  /** Human-readable explanation shown in the results table. */
  message: string;
  /** Structural diff (jsonDiff scorer only) for a side-by-side view. */
  diff?: { added: unknown; removed: unknown; changed: unknown } | null;
}

export type Scorer = (actual: unknown, expected: unknown, passThreshold: number) => ScoreResult;

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Deep-equal structural comparison, with a shallow one-level diff for objects/arrays so the UI can show what changed. */
function jsonDiffScorer(actual: unknown, expected: unknown): ScoreResult {
  const equal = JSON.stringify(actual) === JSON.stringify(expected);
  if (equal) return { pass: true, message: 'Output matches expected output exactly.' };

  const diff = shallowDiff(expected, actual);
  return {
    pass: false,
    message: 'Output does not match expected output.',
    diff,
  };
}

function shallowDiff(expected: unknown, actual: unknown): { added: unknown; removed: unknown; changed: unknown } {
  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);

  if (!isPlainObject(expected) || !isPlainObject(actual)) {
    return { added: null, removed: null, changed: { expected, actual } };
  }

  const added: Record<string, unknown> = {};
  const removed: Record<string, unknown> = {};
  const changed: Record<string, { expected: unknown; actual: unknown }> = {};

  for (const key of Object.keys(actual)) {
    if (!(key in expected)) added[key] = actual[key];
  }
  for (const key of Object.keys(expected)) {
    if (!(key in actual)) removed[key] = expected[key];
    else if (JSON.stringify(expected[key]) !== JSON.stringify(actual[key])) {
      changed[key] = { expected: expected[key], actual: actual[key] };
    }
  }
  return { added, removed, changed };
}

/** Stringified output must equal expectedOutput's stringified form exactly (case-sensitive). */
function exactStringScorer(actual: unknown, expected: unknown): ScoreResult {
  const a = stringify(actual);
  const e = stringify(expected);
  const pass = a === e;
  return { pass, message: pass ? 'Exact string match.' : `Expected exactly "${e}" but got "${a}".` };
}

/** Stringified output must contain expectedOutput's stringified form as a substring. Useful for "the answer mentions X" style checks. */
function containsScorer(actual: unknown, expected: unknown): ScoreResult {
  const a = stringify(actual);
  const e = stringify(expected);
  const pass = a.includes(e);
  return { pass, message: pass ? `Output contains "${e}".` : `Output does not contain "${e}".` };
}

/** Bag-of-words Jaccard similarity — a simple, dependency-free stand-in for
 *  a semantic-similarity scorer. Good enough to flag "close but not
 *  identical" AI-generated text without needing an embeddings call for
 *  every test run; a real embedding-based scorer can be swapped in later
 *  behind the same ScoreResult shape. */
function similarityScorer(actual: unknown, expected: unknown, passThreshold: number): ScoreResult {
  const tokenize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
    );
  const a = tokenize(stringify(actual));
  const e = tokenize(stringify(expected));
  const union = new Set([...a, ...e]);
  const intersection = [...a].filter((t) => e.has(t));
  const score = union.size === 0 ? 1 : intersection.length / union.size;
  const threshold = passThreshold > 0 ? passThreshold : 0.7;
  const pass = score >= threshold;
  return {
    pass,
    score: Math.round(score * 1000) / 1000,
    message: `Similarity ${(score * 100).toFixed(1)}% (threshold ${(threshold * 100).toFixed(0)}%).`,
  };
}

export const SCORERS: Record<string, Scorer> = {
  jsonDiff: jsonDiffScorer,
  exactString: exactStringScorer,
  contains: containsScorer,
  similarity: similarityScorer,
};

export function scoreOutput(scorer: string, actual: unknown, expected: unknown, passThreshold: number): ScoreResult {
  const fn = SCORERS[scorer] ?? SCORERS.jsonDiff;
  return fn(actual, expected, passThreshold);
}
