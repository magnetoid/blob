// @vitest-environment happy-dom
/**
 * A link preview draws the page's name and picture, the picture from Blob's own copy; and
 * several pictures in one message sit as tiles of one size (M3 · B3).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Attachment, LinkPreview, Message } from '@blob/shared';
import { MessageRow } from './MessageRow.tsx';
import { useStore } from '../../lib/store.ts';

afterEach(cleanup);

const ME = 'u-me';

function picture(name: string): Attachment {
  return {
    id: `att-${name}`,
    filename: name,
    mime: 'image/png',
    sizeBytes: 12_288,
    width: 800,
    height: 600,
    url: `/api/files/ws%2F${name}`,
    thumbUrl: null,
    kind: 'file',
  } as unknown as Attachment;
}

function show(extra: { linkPreview?: LinkPreview; attachments?: Attachment[] }) {
  useStore.setState({
    users: { [ME]: { id: ME, displayName: 'Me' } },
    currentUser: { id: ME, displayName: 'Me', prefs: { language: null, autoTranslate: false } },
    customEmoji: [],
    myGroupIds: new Set(),
    savedMessageIds: new Set(),
    toggleSaved: vi.fn(),
    editingMessageId: null,
    messageDeliveryState: () => null,
  } as never);
  const message = {
    id: '01a05000-0000-7000-8000-000000000010',
    channelId: 'c1',
    authorId: ME,
    body: 'see https://news.example.com/story',
    kind: 'user',
    createdAt: '2026-10-21T09:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    threadRootId: null,
    replyCount: 0,
    reactions: [],
    attachments: extra.attachments ?? [],
    linkPreview: extra.linkPreview ?? null,
    mentionUserIds: [],
    mentionGroupIds: [],
  } as unknown as Message;
  return render(<MessageRow message={message} previous={null} onOpenThread={vi.fn()} />);
}

const PREVIEW: LinkPreview = {
  url: 'https://news.example.com/story',
  title: 'Launch notes',
  description: 'What shipped this week.',
  imageUrl: '/api/messages/01a05000-0000-7000-8000-000000000010/preview-image',
  imageWidth: 640,
  imageHeight: 320,
  siteName: 'Northwind Blog',
};

describe('a link preview', () => {
  it('names the site and draws its picture from Blob, at its size', () => {
    const { container } = show({ linkPreview: PREVIEW });
    expect(container.querySelector('.link-preview-site')?.textContent).toBe('Northwind Blog');
    const img = container.querySelector<HTMLImageElement>('.link-preview-image');
    expect(img?.getAttribute('src')).toBe(PREVIEW.imageUrl);
    expect(img?.getAttribute('width')).toBe('640');
    expect(img?.getAttribute('height')).toBe('320');
    expect(img?.getAttribute('alt')).toBe('');
  });

  it('draws no picture it does not have', () => {
    const { container } = show({
      linkPreview: { ...PREVIEW, imageUrl: null, imageWidth: null, imageHeight: null, siteName: null },
    });
    expect(container.querySelector('.link-preview-image')).toBeNull();
    expect(container.querySelector('.link-preview-site')).toBeNull();
    expect(container.querySelector('.link-preview-title')?.textContent).toBe('Launch notes');
  });
});

describe('pictures on a message', () => {
  it('sit as tiles when there are several', () => {
    const { container } = show({ attachments: [picture('a.png'), picture('b.png')] });
    expect(container.querySelector('.attachments')?.getAttribute('data-pictures')).toBe('many');
  });

  it('keep their own shape when there is one', () => {
    const { container } = show({ attachments: [picture('a.png')] });
    expect(container.querySelector('.attachments')?.hasAttribute('data-pictures')).toBe(false);
  });
});
