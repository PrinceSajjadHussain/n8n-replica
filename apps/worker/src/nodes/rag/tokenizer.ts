/**
 * Token counting/encoding for token-aware chunking. Uses `gpt-tokenizer`
 * (pure-JS, no native deps, cl100k_base — same vocab as text-embedding-3-*
 * and gpt-4o) when available, and falls back to a ~4-chars-per-token
 * heuristic so the RAG nodes still work if the package hasn't been
 * installed yet.
 */

let realTokenizer: { encode: (s: string) => number[]; decode: (ids: number[]) => string } | null | undefined;

function loadTokenizer() {
  if (realTokenizer !== undefined) return realTokenizer;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('gpt-tokenizer');
    realTokenizer = { encode: mod.encode, decode: mod.decode };
  } catch {
    realTokenizer = null;
  }
  return realTokenizer;
}

export function countTokens(text: string): number {
  const tok = loadTokenizer();
  if (tok) return tok.encode(text).length;
  return Math.ceil(text.length / 4);
}

/** Splits `text` into consecutive windows of `maxTokens` tokens with `overlapTokens` overlap between windows. */
export function splitByTokens(text: string, maxTokens: number, overlapTokens: number): string[] {
  const tok = loadTokenizer();
  if (tok) {
    const ids = tok.encode(text);
    if (ids.length <= maxTokens) return [text];
    const out: string[] = [];
    const step = Math.max(1, maxTokens - overlapTokens);
    for (let i = 0; i < ids.length; i += step) {
      out.push(tok.decode(ids.slice(i, i + maxTokens)));
      if (i + maxTokens >= ids.length) break;
    }
    return out;
  }
  // Fallback: approximate 1 token ~= 4 chars.
  const maxChars = maxTokens * 4;
  const overlapChars = overlapTokens * 4;
  if (text.length <= maxChars) return [text];
  const out: string[] = [];
  const step = Math.max(1, maxChars - overlapChars);
  for (let i = 0; i < text.length; i += step) {
    out.push(text.slice(i, i + maxChars));
    if (i + maxChars >= text.length) break;
  }
  return out;
}
