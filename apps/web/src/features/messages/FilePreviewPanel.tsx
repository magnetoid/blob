/**
 * A file, open in the conversation's right-hand column.
 *
 * Slack opens an app's object in a panel on the right (Work Objects' flexpane, 2025) and
 * that is the shape here: the conversation stays where it was, and the file sits beside
 * it until closed. The column is the thread panel's, and holds one thing at a time.
 *
 * What it draws comes from three places and never a fourth:
 *
 * - **Text**, fetched from `/api/attachments/:id/preview`, which sends every kind of text
 *   as inert `text/plain`. A document goes through the message renderer; a table, JSON
 *   and code are drawn as text; an SVG goes into a `srcdoc` frame with scripts off and a
 *   no-network policy written in first.
 * - **A web page**, framed from `/api/attachments/:id/page`, where the server sends it
 *   as itself under a header policy of its own — a sandbox with scripts and nothing
 *   else, no network, framable by this origin only. Not `srcdoc`: a `srcdoc` document
 *   inherits this page's policy, whose `script-src 'self'` refuses every inline script a
 *   page has. Opening a file is the person asking for it, so a page runs when its panel
 *   opens; nothing here runs because a message scrolled past.
 * - **A PDF**, framed from the preview URL for the browser's own viewer, which refuses
 *   to run in a sandboxed frame — so the server serves it framable by this origin only.
 *
 * Download is in the header whatever happens, because a preview that fails must never
 * be the only way to the file.
 */
import { useEffect, useState } from 'react';
import type { Attachment } from '@blob/shared';
import { CloseIcon, DownloadIcon, FileIcon } from '../../components/Icon.tsx';
import { api, ApiError } from '../../lib/api.ts';
import {
  delimiterOf,
  pageUrl,
  parseDelimited,
  previewKindOf,
  previewUrl,
  typeLabel,
  type PreviewKind,
} from '../../lib/filePreview.ts';
import { formatBytes } from '../../lib/format.ts';
import { renderMarkdown } from '../../lib/markdown.tsx';
import { useStore } from '../../lib/store.ts';
import { useEscape } from '../../lib/useEscape.ts';
import { framedDocument } from '../work/preview.ts';

/** Rows of a table drawn before the panel says "and more". A spreadsheet is a download. */
const TABLE_ROWS = 500;

/** A picture made of text, centred and fitted, with nothing that could run. */
const PICTURE_STYLE =
  '<style>html,body{margin:0;height:100%}body{display:grid;place-items:center}' +
  'svg{max-width:100%;max-height:100%;height:auto}</style>';

interface Props {
  attachment: Attachment;
  onClose: () => void;
}

export function FilePreviewPanel({ attachment, onClose }: Props) {
  useEscape(onClose);
  const kind = previewKindOf(attachment);

  return (
    <aside className="panel file-preview" aria-label={`Preview of ${attachment.filename}`}>
      <div className="panel-header">
        <div className="file-preview-heading">
          <h2 className="panel-title file-preview-name">
            {attachment.filename}
          </h2>
          <div className="panel-sub">
            {typeLabel(attachment)} · {formatBytes(attachment.sizeBytes)}
          </div>
        </div>
        <div className="file-preview-actions">
          <a
            className="icon-btn"
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Download ${attachment.filename}`}
            title="Download"
          >
            <DownloadIcon size="md" />
          </a>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close preview"
            title="Close preview"
          >
            <CloseIcon size="md" />
          </button>
        </div>
      </div>
      <div className="file-preview-body">
        {kind === null ? (
          <Unavailable attachment={attachment} reason="kind" />
        ) : kind === 'pdf' ? (
          <iframe
            className="file-preview-frame"
            title={attachment.filename}
            src={previewUrl(attachment.id)}
            referrerPolicy="no-referrer"
          />
        ) : kind === 'page' ? (
          <iframe
            className="file-preview-frame"
            title={attachment.filename}
            src={pageUrl(attachment.id)}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
          />
        ) : (
          <TextPreview attachment={attachment} kind={kind} />
        )}
      </div>
    </aside>
  );
}

type Loaded =
  | { state: 'loading' }
  | { state: 'ready'; text: string }
  | { state: 'failed'; reason: Reason };

type Reason = 'kind' | 'too_large' | 'failed';

/** Fetches once per file: the shell keys the panel by attachment, so a new file is a
 *  new panel with its own state rather than an old one showing the wrong text. */
function TextPreview({ attachment, kind }: { attachment: Attachment; kind: PreviewKind }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    api.files.previewText(attachment.id, controller.signal).then(
      (text) => setLoaded({ state: 'ready', text }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const code = error instanceof ApiError ? error.code : 'unknown';
        setLoaded({
          state: 'failed',
          reason:
            code === 'no_preview' ? 'kind' : code === 'preview_too_large' ? 'too_large' : 'failed',
        });
      },
    );
    return () => controller.abort();
  }, [attachment.id]);

  if (loaded.state === 'loading') {
    return (
      <div className="file-preview-status" role="status">
        Loading preview…
      </div>
    );
  }
  if (loaded.state === 'failed') {
    return <Unavailable attachment={attachment} reason={loaded.reason} />;
  }
  return <Drawn attachment={attachment} kind={kind} text={loaded.text} />;
}

function Drawn({
  attachment,
  kind,
  text,
}: {
  attachment: Attachment;
  kind: PreviewKind;
  text: string;
}) {
  const currentUserId = useStore((s) => s.currentUser?.id ?? null);
  const customEmoji = useStore((s) => s.customEmoji);

  switch (kind) {
    case 'markdown':
      // The message renderer, with headings — this is a document — and no mention index:
      // a document is not addressed to anybody, and highlighting `@name` in one would
      // make it look like a notification.
      return (
        <div className="file-preview-document message-body">
          {renderMarkdown(text, {
            knownNames: new Map(),
            currentUserId,
            customEmoji,
            headings: true,
          })}
        </div>
      );
    case 'svg':
      return (
        <iframe
          className="file-preview-frame file-preview-picture"
          title={attachment.filename}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={framedDocument(PICTURE_STYLE + text)}
        />
      );
    case 'table':
      return <Table text={text} delimiter={delimiterOf(attachment)} />;
    case 'json':
      return <Code text={pretty(text)} />;
    default:
      return <Code text={text} />;
  }
}

function Table({ text, delimiter }: { text: string; delimiter: string }) {
  const { rows, truncated } = parseDelimited(text, delimiter, TABLE_ROWS + 1);
  const [head, ...body] = rows;
  if (!head) return <Code text={text} />;
  return (
    <div className="file-preview-table-wrap">
      <table className="file-preview-table">
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={index} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, index) => (
                <td key={index}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && (
        <p className="file-preview-note">
          Showing the first {TABLE_ROWS} rows. Download the file for the rest.
        </p>
      )}
    </div>
  );
}

function Code({ text }: { text: string }) {
  return (
    <pre className="file-preview-code">
      <code>{text}</code>
    </pre>
  );
}

/** JSON indented for reading; anything that does not parse is shown as it came. */
function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function Unavailable({ attachment, reason }: { attachment: Attachment; reason: Reason }) {
  const words =
    reason === 'kind'
      ? 'There’s no preview for this kind of file.'
      : reason === 'too_large'
        ? 'This file is too long to preview.'
        : 'Couldn’t load the preview.';
  return (
    <div className="file-preview-empty">
      <FileIcon size="xl" />
      <p>{words}</p>
      <a className="btn btn-primary" href={attachment.url} target="_blank" rel="noreferrer">
        Download
      </a>
    </div>
  );
}
