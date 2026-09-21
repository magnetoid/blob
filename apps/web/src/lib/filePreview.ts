/**
 * What the side panel makes of a file, and opening it there.
 *
 * The server says only "text", "PDF" or "nothing" (`lib/previews.py`), and sends text as
 * inert `text/plain` whatever it was uploaded as. Deciding *which* kind of text — a
 * document, a page, a picture, a table, code — is the client's, and it is decided here,
 * from the name first and the type second: an agent that did not say what its file was
 * left only the name, and `.tsx` arrives as `application/octet-stream` from most places.
 *
 * The panel shares the conversation's one right-hand column with a thread and a terminal,
 * and that column holds one thing at a time — so opening a file closes the other two, and
 * opening either of them closes the file (`store.openThread`, `openAgentTerminal`).
 */
import type { Attachment } from '@blob/shared';
import { useStore } from './store.ts';

export type PreviewKind =
  | 'markdown'
  | 'page'
  | 'svg'
  | 'table'
  | 'json'
  | 'code'
  | 'text'
  | 'pdf';

/** The images the timeline draws inline — the server's `INLINE_MIME`, and nothing else.
 *  Storage serves every other type as a download, so an `<img>` of an SVG would be a
 *  broken picture; it is a file, and the panel shows it. */
const INLINE_IMAGE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

const CODE = [
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts',
  'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'sql', 'lua', 'pl', 'r', 'scala',
  'dart', 'vue', 'svelte', 'graphql', 'gql', 'proto', 'diff', 'patch', 'css', 'scss',
  'less', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'jsonl', 'ndjson', 'rst',
  'adoc', 'tex',
];

const BY_EXTENSION: Record<string, PreviewKind> = {
  md: 'markdown',
  markdown: 'markdown',
  html: 'page',
  htm: 'page',
  svg: 'svg',
  csv: 'table',
  tsv: 'table',
  json: 'json',
  pdf: 'pdf',
  txt: 'text',
  text: 'text',
  log: 'text',
  ...Object.fromEntries(CODE.map((extension) => [extension, 'code' as const])),
};

const BY_TYPE: Record<string, PreviewKind> = {
  'text/markdown': 'markdown',
  'text/html': 'page',
  'application/xhtml+xml': 'page',
  'image/svg+xml': 'svg',
  'text/csv': 'table',
  'text/tab-separated-values': 'table',
  'application/json': 'json',
  'application/pdf': 'pdf',
};

/** Short names for the card and the panel, where the extension alone would be cryptic. */
const LABELS: Partial<Record<PreviewKind, string>> = {
  markdown: 'Markdown',
  page: 'HTML',
  svg: 'SVG',
  json: 'JSON',
  pdf: 'PDF',
};

function bare(mime: string): string {
  return mime.toLowerCase().split(';', 1)[0]!.trim();
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

export function isInlineImage(mime: string): boolean {
  return INLINE_IMAGE.has(bare(mime));
}

/** How the panel can show this file, or null when it can only be downloaded. */
export function previewKindOf(file: Pick<Attachment, 'filename' | 'mime'>): PreviewKind | null {
  const byName = BY_EXTENSION[extensionOf(file.filename)];
  if (byName) return byName;
  const type = bare(file.mime);
  const byType = BY_TYPE[type];
  if (byType) return byType;
  return type.startsWith('text/') ? 'text' : null;
}

/** "HTML", "PDF", "CSV", "ZIP" — what kind of file this is, in a word. */
export function typeLabel(file: Pick<Attachment, 'filename' | 'mime'>): string {
  const kind = previewKindOf(file);
  const label = kind ? LABELS[kind] : undefined;
  if (label) return label;
  const extension = extensionOf(file.filename);
  return extension ? extension.toUpperCase() : 'File';
}

export function delimiterOf(file: Pick<Attachment, 'filename' | 'mime'>): ',' | '\t' {
  return extensionOf(file.filename) === 'tsv' || bare(file.mime) === 'text/tab-separated-values'
    ? '\t'
    : ',';
}

export function previewUrl(attachmentId: string): string {
  return `/api/attachments/${attachmentId}/preview`;
}

/** A web page, served as itself under a sandbox policy of its own (`routers/files.page`).
 *  Framed from here rather than drawn into `srcdoc`, which would inherit the app's own
 *  policy — and its `script-src 'self'` refuses every inline script a page has. */
export function pageUrl(attachmentId: string): string {
  return `/api/attachments/${attachmentId}/page`;
}

/**
 * Rows and cells of a CSV or TSV, as far as `maxRows`.
 *
 * RFC 4180's rules and no more: a quoted cell may hold the delimiter, a line break, or a
 * doubled quote meaning one. A table is shown, not validated, so nothing here throws —
 * a stray quote just reads to the end of the text as one cell, which is what a
 * spreadsheet would show too.
 */
export function parseDelimited(
  text: string,
  delimiter: string,
  maxRows: number,
): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let index = 0;

  const endRow = (): boolean => {
    row.push(cell);
    rows.push(row);
    row = [];
    cell = '';
    return rows.length >= maxRows;
  };

  while (index < text.length) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 2;
        continue;
      }
      if (char === '"') quoted = false;
      else cell += char;
      index += 1;
      continue;
    }
    if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      if (endRow()) {
        return { rows, truncated: text.slice(index + 1).trim() !== '' };
      }
    } else {
      cell += char;
    }
    index += 1;
  }
  if (cell !== '' || row.length > 0) endRow();
  return { rows: rows.slice(0, maxRows), truncated: rows.length > maxRows };
}

export function openFilePreview(attachment: Attachment): void {
  useStore.setState({
    filePreview: attachment,
    // One thing at a time in the column: whatever was there gives way to what was
    // just asked for, rather than the shell guessing which one was meant.
    activeThreadRootId: null,
    terminalTarget: null,
  });
}

export function closeFilePreview(): void {
  useStore.setState({ filePreview: null });
}
