// @vitest-environment happy-dom
/**
 * The side panel a file opens in.
 *
 * Every kind is drawn from text the server sends as inert `text/plain`, except a PDF,
 * which the browser's own viewer draws from the preview URL, and a web page, framed from
 * its own URL with scripts allowed and nothing else — an opaque origin with no cookies
 * and no way to reach the workspace, under a no-network policy the server sends. An SVG
 * is a picture, so it gets a `srcdoc` box with scripts off. And whatever happens,
 * Download is always there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Attachment } from '@blob/shared';
import { FilePreviewPanel } from './FilePreviewPanel.tsx';
import { useStore } from '../../lib/store.ts';

function file(filename: string, mime: string, overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'a1',
    filename,
    mime,
    sizeBytes: 2048,
    width: null,
    height: null,
    url: '/api/files/ws%2F2026%2Fa1%2Findex.html',
    thumbUrl: null,
    kind: 'file',
    ...overrides,
  } as Attachment;
}

function serverSays(body: string, init: { status?: number; type?: string } = {}) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(body, {
      status: init.status ?? 200,
      headers: { 'content-type': init.type ?? 'text/plain; charset=utf-8' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  useStore.setState({ currentUser: null, customEmoji: [] } as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the panel around a file', () => {
  it('names the file and always offers the download', async () => {
    serverSays('# Plan');
    const item = file('plan.md', 'text/markdown');
    render(<FilePreviewPanel attachment={item} onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'plan.md' })).toBeTruthy();
    const download = screen.getByRole('link', { name: 'Download plan.md' });
    expect(download.getAttribute('href')).toBe(item.url);
  });

  it('closes from its button and from Escape', () => {
    serverSays('# Plan');
    const onClose = vi.fn();
    render(<FilePreviewPanel attachment={file('plan.md', 'text/markdown')} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('asks the server for the text by attachment id', async () => {
    const fetchMock = serverSays('# Plan');
    render(<FilePreviewPanel attachment={file('plan.md', 'text/markdown')} onClose={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Plan' });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/attachments/a1/preview');
  });
});

describe('drawing each kind', () => {
  it('renders a document through the message renderer', async () => {
    serverSays('# Plan\n\nShip **Friday**.');
    render(<FilePreviewPanel attachment={file('plan.md', 'text/markdown')} onClose={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Plan' })).toBeTruthy();
    expect(screen.getByText('Friday').tagName).toBe('STRONG');
  });

  it('frames a page from its own sandboxed URL, scripts allowed and nothing else', () => {
    // Not `srcdoc`: a `srcdoc` document inherits the app's policy, whose
    // `script-src 'self'` refuses every inline script a page has. The page's URL
    // carries a policy of its own (`routers/files.page`).
    const fetchMock = serverSays('');
    render(<FilePreviewPanel attachment={file('index.html', 'text/html')} onClose={vi.fn()} />);

    const frame = screen.getByTitle('index.html') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe('/api/attachments/a1/page');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.hasAttribute('srcdoc')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows an SVG in the same box with scripts off', async () => {
    serverSays('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    render(<FilePreviewPanel attachment={file('logo.svg', 'image/svg+xml')} onClose={vi.fn()} />);

    const frame = (await screen.findByTitle('logo.svg')) as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('');
  });

  it('lays a CSV out as a table with its first row as the header', async () => {
    serverSays('name,count\nana,1\nbo,2\n');
    render(<FilePreviewPanel attachment={file('counts.csv', 'text/csv')} onClose={vi.fn()} />);

    expect(await screen.findByRole('columnheader', { name: 'name' })).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('cell', { name: 'bo' })).toBeTruthy();
  });

  it('pretty-prints JSON', async () => {
    serverSays('{"a":1,"b":[1,2]}');
    render(<FilePreviewPanel attachment={file('data.json', 'application/json')} onClose={vi.fn()} />);

    const code = await screen.findByText(/"a": 1/);
    expect(code.textContent).toContain('"b": [\n    1,\n    2\n  ]');
  });

  it('shows code as text, never as markup', async () => {
    serverSays('print("<b>hi</b>")');
    render(<FilePreviewPanel attachment={file('main.py', 'text/x-python')} onClose={vi.fn()} />);

    const code = await screen.findByText('print("<b>hi</b>")');
    expect(code.closest('pre')).toBeTruthy();
    expect(document.querySelector('b')).toBeNull();
  });

  it('frames a PDF for the browser’s own viewer without fetching it itself', () => {
    const fetchMock = serverSays('');
    render(<FilePreviewPanel attachment={file('report.pdf', 'application/pdf')} onClose={vi.fn()} />);

    const frame = screen.getByTitle('report.pdf') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe('/api/attachments/a1/preview');
    expect(frame.hasAttribute('sandbox')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('when there is nothing to show', () => {
  it('says so for a kind with no preview, and offers the download', () => {
    const fetchMock = serverSays('');
    render(<FilePreviewPanel attachment={file('site.zip', 'application/zip')} onClose={vi.fn()} />);

    expect(screen.getByText(/no preview for this kind of file/i)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /download/i }).length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says a file is too long when the server does', async () => {
    serverSays(
      JSON.stringify({ error: { code: 'preview_too_large', message: 'That file is too long.' } }),
      { status: 400, type: 'application/json' },
    );
    render(<FilePreviewPanel attachment={file('big.log', 'text/plain')} onClose={vi.fn()} />);

    expect(await screen.findByText(/too long to preview/i)).toBeTruthy();
  });

  it('says it could not load when anything else goes wrong', async () => {
    serverSays('', { status: 500 });
    render(<FilePreviewPanel attachment={file('plan.md', 'text/markdown')} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/couldn.t load the preview/i)).toBeTruthy());
  });
});
