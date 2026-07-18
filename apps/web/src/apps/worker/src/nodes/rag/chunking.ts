import type { Chunk, LoadedDocument } from './types';
import { splitByTokens, countTokens } from './tokenizer';

export type ChunkingStrategy = 'fixed' | 'token' | 'markdown' | 'semantic';

export interface ChunkingOptions {
  strategy: ChunkingStrategy;
  /** fixed strategy: max characters per chunk. */
  chunkSize?: number;
  /** fixed strategy: character overlap between consecutive chunks. */
  chunkOverlap?: number;
  /** token strategy (and markdown's sub-splitting): max tokens per chunk. */
  maxTokens?: number;
  /** token strategy (and markdown's sub-splitting): token overlap between consecutive chunks. */
  overlapTokens?: number;
  /** semantic strategy: cosine-distance breakpoint (0-1) above which a new chunk starts. Higher = fewer, larger chunks. */
  breakpointThreshold?: number;
  /** semantic strategy: hard ceiling in tokens so one "semantically coherent" run doesn't grow unbounded. */
  semanticMaxTokens?: number;
}

const DEFAULTS: Required<Pick<ChunkingOptions, 'chunkSize' | 'chunkOverlap' | 'maxTokens' | 'overlapTokens' | 'breakpointThreshold' | 'semanticMaxTokens'>> = {
  chunkSize: 1000,
  chunkOverlap: 150,
  maxTokens: 300,
  overlapTokens: 40,
  breakpointThreshold: 0.25,
  semanticMaxTokens: 500,
};

// ---------------------------------------------------------------------------
// Fixed-size (character based) — the original, simplest strategy.
// ---------------------------------------------------------------------------
function fixedSizeChunk(text: string, chunkSize: number, overlap: number): { text: string; startChar: number }[] {
  const out: { text: string; startChar: number }[] = [];
  const step = Math.max(1, chunkSize - overlap);
  for (let i = 0; i < text.length; i += step) {
    const slice = text.slice(i, i + chunkSize);
    if (slice.trim()) out.push({ text: slice, startChar: i });
    if (i + chunkSize >= text.length) break;
  }
  return out.length ? out : [{ text, startChar: 0 }];
}

// ---------------------------------------------------------------------------
// Token-aware — respects the embedding model's actual tokenizer instead of
// a character count, so chunks reliably fit the model's context/limits.
// ---------------------------------------------------------------------------
function tokenAwareChunk(text: string, maxTokens: number, overlapTokens: number): string[] {
  return splitByTokens(text, maxTokens, overlapTokens);
}

// ---------------------------------------------------------------------------
// Markdown-aware — splits along heading boundaries first (so a chunk never
// straddles two unrelated sections), keeping a "breadcrumb" of the heading
// path in metadata; any section still too large is sub-split token-aware.
// ---------------------------------------------------------------------------
interface MdSection {
  headerPath: string[];
  text: string;
}

function splitMarkdownSections(text: string): MdSection[] {
  const lines = text.split(/\r?\n/);
  const sections: MdSection[] = [];
  let stack: { level: number; title: string }[] = [];
  let buf: string[] = [];

  const flush = () => {
    const body = buf.join('\n').trim();
    if (body) sections.push({ headerPath: stack.map((s) => s.title), text: body });
    buf = [];
  };

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      flush();
      const level = m[1].length;
      stack = stack.filter((s) => s.level < level);
      stack.push({ level, title: m[2].trim() });
      continue;
    }
    buf.push(line);
  }
  flush();

  // No headings found at all — treat the whole thing as one section.
  if (sections.length === 0) return [{ headerPath: [], text }];
  return sections;
}

function markdownAwareChunk(text: string, maxTokens: number, overlapTokens: number): { text: string; headerPath: string[] }[] {
  const sections = splitMarkdownSections(text);
  const out: { text: string; headerPath: string[] }[] = [];
  for (const section of sections) {
    if (countTokens(section.text) <= maxTokens) {
      out.push({ text: section.text, headerPath: section.headerPath });
    } else {
      for (const piece of splitByTokens(section.text, maxTokens, overlapTokens)) {
        out.push({ text: piece, headerPath: section.headerPath });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Semantic — splits into sentences, embeds each, and merges runs of
// sentences whose neighbour-to-neighbour cosine similarity stays above the
// breakpoint threshold, so a chunk boundary lands where the *topic* shifts
// rather than at an arbitrary character/token count.
// ---------------------------------------------------------------------------
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'\u2018\u201c])|\n{2,}/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export async function semanticChunk(
  text: string,
  opts: { breakpointThreshold: number; semanticMaxTokens: number },
  embedFn: (texts: string[]) => Promise<number[][]>
): Promise<string[]> {
  const sentences = splitSentences(text);
  if (sentences.length <= 1) return sentences;

  const embeddings = await embedFn(sentences);
  const groups: string[][] = [[sentences[0]]];
  let groupTokens = countTokens(sentences[0]);

  for (let i = 1; i < sentences.length; i++) {
    const sim = cosineSim(embeddings[i - 1], embeddings[i]);
    const distance = 1 - sim;
    const sentenceTokens = countTokens(sentences[i]);
    const currentGroup = groups[groups.length - 1];
    const fitsSameTopic = distance <= opts.breakpointThreshold;
    const fitsSizeLimit = groupTokens + sentenceTokens <= opts.semanticMaxTokens;

    if (fitsSameTopic && fitsSizeLimit) {
      currentGroup.push(sentences[i]);
      groupTokens += sentenceTokens;
    } else {
      groups.push([sentences[i]]);
      groupTokens = sentenceTokens;
    }
  }

  return groups.map((g) => g.join(' '));
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------
export async function chunkDocument(
  doc: LoadedDocument,
  opts: ChunkingOptions,
  embedFn: (texts: string[]) => Promise<number[][]>
): Promise<Chunk[]> {
  const o = { ...DEFAULTS, ...opts };
  const text = doc.text.trim();
  if (!text) return [];

  if (o.strategy === 'fixed') {
    return fixedSizeChunk(text, o.chunkSize, o.chunkOverlap).map((c, i) => ({
      text: c.text,
      meta: { ...doc.meta, chunkIndex: i, chunkStrategy: 'fixed', startChar: c.startChar },
    }));
  }

  if (o.strategy === 'token') {
    return tokenAwareChunk(text, o.maxTokens, o.overlapTokens).map((t, i) => ({
      text: t,
      meta: { ...doc.meta, chunkIndex: i, chunkStrategy: 'token' },
    }));
  }

  if (o.strategy === 'markdown') {
    return markdownAwareChunk(text, o.maxTokens, o.overlapTokens).map((c, i) => ({
      text: c.text,
      meta: {
        ...doc.meta,
        chunkIndex: i,
        chunkStrategy: 'markdown',
        headerPath: c.headerPath,
        headerPathLabel: c.headerPath.join(' > ') || undefined,
      },
    }));
  }

  // semantic
  const pieces = await semanticChunk(text, { breakpointThreshold: o.breakpointThreshold, semanticMaxTokens: o.semanticMaxTokens }, embedFn);
  return pieces.map((t, i) => ({
    text: t,
    meta: { ...doc.meta, chunkIndex: i, chunkStrategy: 'semantic' },
  }));
}
