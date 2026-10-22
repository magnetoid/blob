// @vitest-environment happy-dom
/**
 * An agent's reply outside its conversation — a search hit, a thread, a saved item.
 *
 * It reads in the agent's dialect here too, so a table found by search is a table and not
 * a row of pipes. It does not fold: this row clamps the body to a few lines already, and
 * the whole row is a button, which a "Show more" inside could not be.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Message } from '@blob/shared';
import { useStore } from '../../lib/store.ts';
import { MessageResultRow } from './MessageResultRow.tsx';

afterEach(cleanup);

const BODY = '## Findings\n\n| Metric | p95 |\n|---|---|\n| verify | 2.4 s |';

function hit(authorId: string) {
  useStore.setState({
    users: {
      u1: { id: 'u1', kind: 'human', displayName: 'Marko', deactivated: false },
      b1: { id: 'b1', kind: 'bot', displayName: 'Janus', deactivated: false },
    },
    channels: { c1: { id: 'c1', name: 'general', kind: 'public' } },
    groups: {},
    myGroupIds: new Set(),
    currentUser: { id: 'u-me', displayName: 'Me', prefs: {} },
    customEmoji: [],
  } as never);
  const message = {
    id: '01a05000-0000-7000-8000-00000000cafe',
    channelId: 'c1',
    authorId,
    body: BODY,
    createdAt: '2026-10-09T09:00:00.000Z',
    reactions: [],
    attachments: [],
  } as unknown as Message;
  return render(<MessageResultRow message={message} timestamp={null} onOpen={vi.fn()} />)
    .container;
}

describe('a reply found outside its conversation', () => {
  it("draws an agent's section and table, with no fold and no button inside the row", () => {
    const container = hit('b1');
    const text = container.querySelector('.search-result-text');
    expect(text?.querySelector('.md-section')?.textContent).toBe('Findings');
    expect(text?.querySelector('table')).not.toBeNull();
    expect(text?.querySelector('.reply-fold')).toBeNull();
    // The row is the one button.
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });

  it("leaves a person's the characters they typed", () => {
    const text = hit('u1').querySelector('.search-result-text');
    expect(text?.querySelector('.md-section, table')).toBeNull();
    expect(text?.textContent).toContain('## Findings');
  });
});

describe('where a found message was said', () => {
  function found(authorId: string, channel: Record<string, unknown> | null) {
    useStore.setState({
      users: {
        'u-me': { id: 'u-me', kind: 'human', displayName: 'Me', deactivated: false },
        u2: { id: 'u2', kind: 'human', displayName: 'Devin Cole', deactivated: false },
      },
      channels: channel ? { c1: { id: 'c1', ...channel } } : {},
      groups: {},
      myGroupIds: new Set(),
      currentUser: { id: 'u-me', displayName: 'Me', prefs: {} },
      customEmoji: [],
      channelTitle: () => 'Devin Cole',
    } as never);
    const message = {
      id: '01a05000-0000-7000-8000-00000000beef',
      channelId: 'c1',
      authorId,
      body: 'the numbers are in',
      createdAt: '2026-10-09T09:00:00.000Z',
      reactions: [],
      attachments: [],
    } as unknown as Message;
    const { container } = render(
      <MessageResultRow message={message} timestamp={null} onOpen={vi.fn()} />,
    );
    return container.querySelector('.search-result-meta')?.textContent;
  }

  it('names a channel by its name', () => {
    expect(found('u2', { name: 'general', kind: 'public' })).toBe('#general');
  });

  it("says a direct message is one, rather than repeating its author's name", () => {
    // The conversation's title is the other person: beside their own name it read
    // "Devin Cole · Devin Cole".
    expect(found('u2', { name: null, kind: 'dm', memberIds: ['u-me', 'u2'] })).toBe('Direct message');
  });

  it('says whom your own direct message went to', () => {
    expect(found('u-me', { name: null, kind: 'dm', memberIds: ['u-me', 'u2'] })).toBe('To Devin Cole');
  });

  it('says a conversation it cannot name is one, not "Unknown"', () => {
    expect(found('u2', null)).toBe('A conversation');
  });
});
