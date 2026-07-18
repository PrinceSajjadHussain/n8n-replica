import axios from 'axios';
import type { LoadedDocument } from './types';

// ---------------------------------------------------------------------------
// File-format loaders — given raw bytes + a mime/filename hint, extract text.
// ---------------------------------------------------------------------------

export async function loadPdf(buffer: Buffer, fileName?: string): Promise<LoadedDocument[]> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = require('pdf-parse');
  const result = await pdfParse(buffer);
  return [
    {
      text: result.text,
      meta: { sourceType: 'pdf', fileName, pageCount: result.numpages },
    },
  ];
}

export async function loadDocx(buffer: Buffer, fileName?: string): Promise<LoadedDocument[]> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return [{ text: result.value, meta: { sourceType: 'docx', fileName } }];
}

/**
 * CSV loader — each row becomes its own "document" (own chunk lineage),
 * rendered as `col: value` lines so embeddings capture column semantics,
 * with the raw row plus row number stamped into metadata for filtering/
 * citation display.
 */
export async function loadCsv(buffer: Buffer, fileName?: string): Promise<LoadedDocument[]> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { parse } = require('csv-parse/sync');
  const records: Record<string, string>[] = parse(buffer, { columns: true, skip_empty_lines: true, trim: true });
  return records.map((row, i) => ({
    text: Object.entries(row)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n'),
    meta: { sourceType: 'csv', fileName, row: i + 1, columns: row },
  }));
}

export function loadHtml(html: string, url?: string): LoadedDocument[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  $('script, style, noscript, nav, footer').remove();
  const title = $('title').first().text().trim() || undefined;
  const text = $('body').text().replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n\n').trim();
  return [{ text, meta: { sourceType: 'html', url, title } }];
}

/**
 * Plain-text / markdown passthrough — for `documents: string[]` or raw
 * `text` params, or upstream node output that is already text.
 */
export function loadPlainText(text: string, meta: Record<string, unknown> = {}): LoadedDocument[] {
  return [{ text, meta: { sourceType: 'text', ...meta } }];
}

/** Dispatches on file extension / mime type to the right binary loader. */
export async function loadFromBinary(buffer: Buffer, mimeType: string, fileName?: string): Promise<LoadedDocument[]> {
  const ext = (fileName?.split('.').pop() || '').toLowerCase();
  if (mimeType.includes('pdf') || ext === 'pdf') return loadPdf(buffer, fileName);
  if (mimeType.includes('officedocument.wordprocessingml') || ext === 'docx') return loadDocx(buffer, fileName);
  if (mimeType.includes('csv') || ext === 'csv') return loadCsv(buffer, fileName);
  if (mimeType.includes('html') || ext === 'html' || ext === 'htm') return loadHtml(buffer.toString('utf-8'), fileName);
  // Fall back to treating it as plain text (markdown, .txt, json, etc).
  return loadPlainText(buffer.toString('utf-8'), { sourceType: 'text', fileName });
}

// ---------------------------------------------------------------------------
// Website crawler — breadth-first, same-domain by default, HTML->text via
// the html loader above. Cheap and dependency-light (axios + cheerio); no
// headless browser, so JS-rendered SPAs won't be fully captured.
// ---------------------------------------------------------------------------
export interface CrawlOptions {
  startUrl: string;
  maxPages?: number;
  sameDomainOnly?: boolean;
  /** Optional CSS-selector allow/deny isn't implemented — kept simple: strips nav/footer/script only. */
}

export async function crawlWebsite(opts: CrawlOptions): Promise<LoadedDocument[]> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cheerio = require('cheerio');
  const maxPages = opts.maxPages ?? 20;
  const sameDomainOnly = opts.sameDomainOnly ?? true;
  const startHost = new URL(opts.startUrl).host;

  const visited = new Set<string>();
  const queue: string[] = [opts.startUrl];
  const docs: LoadedDocument[] = [];

  while (queue.length && visited.size < maxPages) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    let html: string;
    try {
      const res = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'FlowForgeRAGBot/1.0' } });
      html = res.data;
    } catch {
      continue; // skip unreachable pages, keep crawling the rest
    }

    const [doc] = loadHtml(html, url);
    if (doc.text.trim()) docs.push(doc);

    const $ = cheerio.load(html);
    $('a[href]').each((_i: number, el: unknown) => {
      if (visited.size + queue.length >= maxPages) return;
      const href = $(el).attr('href');
      if (!href) return;
      try {
        const next = new URL(href, url);
        next.hash = '';
        if (sameDomainOnly && next.host !== startHost) return;
        if (!/^https?:$/.test(next.protocol)) return;
        const normalized = next.toString();
        if (!visited.has(normalized)) queue.push(normalized);
      } catch {
        /* ignore malformed URLs */
      }
    });
  }

  return docs;
}

// ---------------------------------------------------------------------------
// Connectors — Google Drive, Notion, Confluence. Each takes a decrypted
// credential (the same shape used elsewhere in FlowForge: 'google' OAuth
// access tokens, 'notion' API key, 'confluence' email+API token) plus the
// document/page identifier to fetch, and returns loader-ready documents.
// ---------------------------------------------------------------------------

const GOOGLE_EXPORT_MIME: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

/** Google Drive — credential (type 'google'): { accessToken }. Handles native Google Docs/Sheets/Slides (export) and uploaded PDF/DOCX/CSV/txt files (download) transparently. */
export async function loadGoogleDriveFile(accessToken: string, fileId: string): Promise<LoadedDocument[]> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const meta = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    headers,
    params: { fields: 'id,name,mimeType' },
    timeout: 15000,
  });
  const { mimeType, name } = meta.data as { mimeType: string; name: string };

  if (GOOGLE_EXPORT_MIME[mimeType]) {
    const exportMime = GOOGLE_EXPORT_MIME[mimeType];
    const res = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}/export`, {
      headers,
      params: { mimeType: exportMime },
      responseType: exportMime === 'text/csv' ? 'arraybuffer' : 'text',
      timeout: 30000,
    });
    if (exportMime === 'text/csv') return loadCsv(Buffer.from(res.data), name);
    return loadPlainText(String(res.data), { sourceType: 'googleDrive', fileName: name, fileId });
  }

  const res = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    headers,
    params: { alt: 'media' },
    responseType: 'arraybuffer',
    timeout: 30000,
  });
  const docs = await loadFromBinary(Buffer.from(res.data), mimeType, name);
  return docs.map((d) => ({ ...d, meta: { ...d.meta, sourceType: 'googleDrive', fileId } }));
}

/** Notion — credential (type 'notion'): { apiKey }. Recursively flattens a page's blocks (and child pages, one level) into plain text. */
export async function loadNotionPage(apiKey: string, pageId: string, depth = 0): Promise<LoadedDocument[]> {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Notion-Version': '2022-06-28' };
  const pageMeta = await axios.get(`https://api.notion.com/v1/pages/${pageId}`, { headers, timeout: 15000 }).catch(() => null);
  const title =
    pageMeta?.data?.properties &&
    (Object.values(pageMeta.data.properties as Record<string, any>).find((p: any) => p.type === 'title')?.title?.[0]?.plain_text as
      | string
      | undefined);

  const lines: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await axios.get(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      headers,
      params: { page_size: 100, start_cursor: cursor },
      timeout: 15000,
    });
    for (const block of res.data.results as any[]) {
      lines.push(...notionBlockToLines(block));
    }
    cursor = res.data.has_more ? res.data.next_cursor : undefined;
  } while (cursor);

  return [{ text: lines.join('\n'), meta: { sourceType: 'notion', pageId, title } }];
}

function notionBlockToLines(block: any): string[] {
  const type = block.type;
  const richText = (block[type]?.rich_text ?? []) as any[];
  const text = richText.map((t) => t.plain_text).join('');
  if (!text) return [];
  switch (type) {
    case 'heading_1':
      return [`# ${text}`];
    case 'heading_2':
      return [`## ${text}`];
    case 'heading_3':
      return [`### ${text}`];
    case 'bulleted_list_item':
    case 'to_do':
      return [`- ${text}`];
    default:
      return [text];
  }
}

/** Confluence — credential (type 'confluence'): { email, apiToken }. `baseUrl` e.g. https://your-domain.atlassian.net/wiki. */
export async function loadConfluencePage(
  baseUrl: string,
  email: string,
  apiToken: string,
  pageId: string
): Promise<LoadedDocument[]> {
  const auth = { username: email, password: apiToken };
  const res = await axios.get(`${baseUrl.replace(/\/$/, '')}/rest/api/content/${pageId}`, {
    auth,
    params: { expand: 'body.storage,space' },
    timeout: 15000,
  });
  const html = res.data?.body?.storage?.value ?? '';
  const [doc] = loadHtml(html, `${baseUrl}/pages/${pageId}`);
  return [{ text: doc.text, meta: { sourceType: 'confluence', pageId, title: res.data?.title, space: res.data?.space?.key } }];
}
