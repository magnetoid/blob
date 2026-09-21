// @vitest-environment happy-dom
/**
 * A file on a message: a card that opens the side panel, and a Download button that is
 * always there.
 *
 * The card used to be one link that downloaded, which is how an agent's page could be
 * "here" and still not be anywhere anybody could look at it. A plain click now opens the
 * preview; a modified click is somebody asking for a tab and still gets one; a file the
 * panel cannot show downloads as before. An SVG is a file, not an `<img>` — storage serves
 * it as a download, so an image tag would draw a broken picture.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Attachment, Message } from '@blob/shared';
import { MessageRow } from './MessageRow.tsx';
import { useStore } from '../../lib/store.ts';

afterEach(() => {
  cleanup();
  useStore.setState({ filePreview: null });
});

const ME = 'u-me';
const BOT = 'u-janus';

function attachment(filename: string, mime: string): Attachment {
  return {
    id: `att-${filename}`,
    filename,
    mime,
    sizeBytes: 12_288,
    width: null,
    height: null,
    url: `/api/files/ws%2F${filename}`,
    thumbUrl: null,
    kind: 'file',
    durationMs: null,
    waveform: null,
    transcriptStatus: 'none',
  } as unknown as Attachment;
}

function show(...attachments: Attachment[]) {
  useStore.setState({
    users: {
      [ME]: { id: ME, displayName: 'Me' },
      [BOT]: { id: BOT, displayName: 'Janus', isBot: true },
    },
    currentUser: { id: ME, displayName: 'Me', prefs: { language: null, autoTranslate: false } },
    customEmoji: [],
    myGroupIds: new Set(),
    savedMessageIds: new Set(),
    toggleSaved: vi.fn(),
    editingMessageId: null,
    messageDeliveryState: () => null,
  } as never);
  const message = {
    id: '01a05000-0000-7000-8000-000000000009',
    channelId: 'c1',
    authorId: BOT,
    body: 'Built it.',
    kind: 'bot',
    createdAt: '2026-09-21T09:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    threadRootId: null,
    replyCount: 0,
    reactions: [],
    attachments,
    mentionUserIds: [],
    mentionGroupIds: [],
  } as unknown as Message;
  render(<MessageRow message={message} previous={null} onOpenThread={vi.fn()} />);
}

describe('a file on a message', () => {
  it('opens in the side panel on a plain click', () => {
    const page = attachment('index.html', 'text/html');
    show(page);

    const card = screen.getByRole('link', { name: /^index\.html/ });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    card.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(useStore.getState().filePreview?.id).toBe(page.id);
  });

  it('leaves a modified click to the browser', () => {
    show(attachment('index.html', 'text/html'));

    window.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(screen.getByRole('link', { name: /^index\.html/ }), { metaKey: true });

    expect(useStore.getState().filePreview).toBeNull();
  });

  it('downloads what the panel cannot show', () => {
    show(attachment('site.zip', 'application/zip'));

    // Read after the row's own handler has had its say, then stop happy-dom actually
    // following the link to a server that is not there.
    let leftToTheBrowser: boolean | null = null;
    window.addEventListener(
      'click',
      (event) => {
        leftToTheBrowser = !event.defaultPrevented;
        event.preventDefault();
      },
      { once: true },
    );
    fireEvent.click(screen.getByRole('link', { name: /^site\.zip/ }));

    expect(leftToTheBrowser).toBe(true);
    expect(useStore.getState().filePreview).toBeNull();
  });

  it('always has a Download button of its own', () => {
    const page = attachment('index.html', 'text/html');
    show(page);

    const download = screen.getByRole('link', { name: 'Download index.html' });
    expect(download.getAttribute('href')).toBe(page.url);
  });

  it('says what kind of file it is and how big', () => {
    show(attachment('index.html', 'text/html'));

    expect(screen.getByText(/12 KB/)).toBeTruthy();
    expect(screen.getByText(/HTML/)).toBeTruthy();
  });

  it('draws an SVG as a file, not an image', () => {
    show(attachment('logo.svg', 'image/svg+xml'));

    expect(document.querySelector('img.attachment-image')).toBeNull();
    expect(screen.getByRole('link', { name: /^logo\.svg/ })).toBeTruthy();
  });
});
