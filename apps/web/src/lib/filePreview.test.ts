/**
 * What the side panel makes of a file, decided from its name and type.
 *
 * The server answers "text", "PDF" or "nothing" (`lib/previews.py`); the client decides
 * which kind of text — a document, a page, a picture, a table, code. These pin that
 * table, the timeline's rule for which images are drawn inline (the server's own
 * allowlist, so an SVG is a file and never an `<img>`), and the small CSV reader the
 * table uses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Attachment } from '@blob/shared';
import { api } from './api.ts';
import {
  closeFilePreview,
  isInlineImage,
  openFilePreview,
  parseDelimited,
  previewKindOf,
  previewUrl,
} from './filePreview.ts';
import { useStore } from './store.ts';

function file(filename: string, mime: string): Attachment {
  return {
    id: 'a1',
    filename,
    mime,
    sizeBytes: 10,
    width: null,
    height: null,
    url: '/api/files/ws%2Fa1',
    thumbUrl: null,
    kind: 'file',
  } as Attachment;
}

describe('what kind of preview a file gets', () => {
  it.each([
    ['index.html', 'text/html', 'page'],
    ['page.htm', 'application/octet-stream', 'page'],
    ['notes.md', 'text/markdown', 'markdown'],
    ['README.markdown', 'text/plain', 'markdown'],
    ['logo.svg', 'image/svg+xml', 'svg'],
    ['counts.csv', 'text/csv', 'table'],
    ['counts.tsv', 'text/tab-separated-values', 'table'],
    ['data.json', 'application/json', 'json'],
    ['main.py', 'text/x-python', 'code'],
    ['app.tsx', 'application/octet-stream', 'code'],
    ['server.log', 'text/plain', 'text'],
    ['report.pdf', 'application/pdf', 'pdf'],
  ])('%s (%s) is a %s', (name, mime, kind) => {
    expect(previewKindOf(file(name, mime))).toBe(kind);
  });

  it('falls back to the type when the name says nothing', () => {
    expect(previewKindOf(file('download', 'text/html'))).toBe('page');
    expect(previewKindOf(file('download', 'application/pdf'))).toBe('pdf');
    expect(previewKindOf(file('download', 'text/plain'))).toBe('text');
  });

  it('has nothing to show for archives, office files or media', () => {
    const cases: [string, string][] = [
      ['site.zip', 'application/zip'],
      ['deck.pptx', 'application/octet-stream'],
      ['clip.mp4', 'video/mp4'],
      ['song.mp3', 'audio/mpeg'],
    ];
    for (const [name, mime] of cases) {
      expect(previewKindOf(file(name, mime))).toBeNull();
    }
  });

  it('does not offer a panel for an image the timeline already draws', () => {
    expect(previewKindOf(file('shot.png', 'image/png'))).toBeNull();
  });

  it('asks the server for a preview by attachment id', () => {
    expect(previewUrl('a1')).toBe('/api/attachments/a1/preview');
  });
});

describe('which images the timeline draws inline', () => {
  it('is the server allowlist and nothing else', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']) {
      expect(isInlineImage(mime)).toBe(true);
    }
    expect(isInlineImage('IMAGE/PNG')).toBe(true);
    expect(isInlineImage('image/svg+xml')).toBe(false);
    expect(isInlineImage('image/tiff')).toBe(false);
  });
});

describe('reading a table', () => {
  it('splits rows and cells', () => {
    expect(parseDelimited('a,b\n1,2\n', ',', 100).rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps commas, quotes and line breaks inside quoted cells', () => {
    const text = 'name,note\n"Doe, Jane","said ""hi""\nthen left"\r\nAna,ok';
    expect(parseDelimited(text, ',', 100).rows).toEqual([
      ['name', 'note'],
      ['Doe, Jane', 'said "hi"\nthen left'],
      ['Ana', 'ok'],
    ]);
  });

  it('reads tabs when asked to', () => {
    expect(parseDelimited('a\tb\n1\t2', '\t', 100).rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('stops at the row cap and says it did', () => {
    const text = Array.from({ length: 10 }, (_, n) => `${n},x`).join('\n');
    const read = parseDelimited(text, ',', 4);
    expect(read.rows).toHaveLength(4);
    expect(read.truncated).toBe(true);
    expect(parseDelimited('a\nb', ',', 4).truncated).toBe(false);
  });
});

describe('the one right-hand column', () => {
  afterEach(() => {
    useStore.setState({ filePreview: null, activeThreadRootId: null, terminalTarget: null });
  });

  it('opening a file closes a thread or a terminal', () => {
    useStore.setState({
      activeThreadRootId: 'root',
      terminalTarget: { pluginId: 'p', agentName: 'Janus' },
    });

    openFilePreview(file('index.html', 'text/html'));

    const state = useStore.getState();
    expect(state.filePreview?.filename).toBe('index.html');
    expect(state.activeThreadRootId).toBeNull();
    expect(state.terminalTarget).toBeNull();
  });

  it('opening a thread closes the file', async () => {
    vi.spyOn(api.messages, 'thread').mockResolvedValue({ messages: [] } as never);
    useStore.setState({ filePreview: file('index.html', 'text/html') });

    await useStore.getState().openThread('root');

    expect(useStore.getState().filePreview).toBeNull();
    expect(useStore.getState().activeThreadRootId).toBe('root');
  });

  it('opening a channel closes the file', async () => {
    useStore.setState({ filePreview: file('index.html', 'text/html') });

    void useStore.getState().openChannel('c2').catch(() => undefined);

    expect(useStore.getState().filePreview).toBeNull();
  });

  it('closes', () => {
    openFilePreview(file('index.html', 'text/html'));
    closeFilePreview();
    expect(useStore.getState().filePreview).toBeNull();
  });
});
