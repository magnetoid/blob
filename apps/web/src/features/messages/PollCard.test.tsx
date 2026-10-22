// @vitest-environment happy-dom
/**
 * A poll under its question (ADR 0041): what it shows, a vote, and who may close it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Message, Poll } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { PollCard } from './PollCard.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useStore.setState({ currentUser: null, users: {} } as never);
});

function as(id: string, role = 'member'): void {
  useStore.setState({
    currentUser: { id, kind: 'human', displayName: id, role, deactivated: false },
    users: {
      ana: { id: 'ana', displayName: 'Ana Petrov' },
      bo: { id: 'bo', displayName: 'Bo Chen' },
    },
  } as never);
}

function poll(overrides: Partial<Poll> = {}): Poll {
  return {
    options: [
      { id: 'o1', text: 'Lisbon', count: 2, voterIds: ['ana', 'bo'] },
      { id: 'o2', text: 'Belgrade', count: 0, voterIds: [] },
    ],
    multiple: false,
    anonymous: false,
    voters: 2,
    closedAt: null,
    ...overrides,
  };
}

function message(p: Poll, authorId = 'ana'): Message {
  return {
    id: 'm1',
    channelId: 'c1',
    authorId,
    kind: 'user',
    body: 'Where should the offsite be?',
    threadRootId: null,
    alsoInChannel: false,
    replyCount: 0,
    replyUserIds: [],
    lastReplyAt: null,
    mentionUserIds: [],
    mentionGroupIds: [],
    mentionsEveryone: false,
    clientMsgId: 'client-1',
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    createdAt: '2026-10-22T10:00:00.000Z',
    reactions: [],
    attachments: [],
    linkPreview: null,
    poll: p,
  } as Message;
}

describe('a public poll', () => {
  it('shows each option, its count and who chose it, and marks your own', () => {
    as('bo');
    render(<PollCard message={message(poll())} />);
    const lisbon = screen.getByRole('button', { name: /Lisbon/ });
    expect(lisbon.getAttribute('aria-pressed')).toBe('true');
    expect(lisbon.getAttribute('title')).toBe('Ana Petrov, Bo Chen');
    expect(screen.getByRole('button', { name: /Belgrade/ }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(screen.getByText('2 people voted')).toBeTruthy();
  });

  it('votes for one option, replacing your choice, and shows the answer at once', async () => {
    as('bo');
    const answered = message(
      poll({
        options: [
          { id: 'o1', text: 'Lisbon', count: 1, voterIds: ['ana'] },
          { id: 'o2', text: 'Belgrade', count: 1, voterIds: ['bo'] },
        ],
      }),
    );
    const vote = vi.spyOn(api.messages, 'vote').mockResolvedValue({ message: answered, mine: ['o2'] });
    const apply = vi.spyOn(useStore.getState(), 'applyEvent');
    render(<PollCard message={message(poll())} />);

    fireEvent.click(screen.getByRole('button', { name: /Belgrade/ }));
    await waitFor(() => expect(vote).toHaveBeenCalledWith('m1', ['o2']));
    await waitFor(() =>
      expect(apply).toHaveBeenCalledWith({ t: 'message.updated', message: answered }),
    );
  });

  it('adds to your choice where several may be chosen', async () => {
    as('bo');
    const vote = vi
      .spyOn(api.messages, 'vote')
      .mockResolvedValue({ message: message(poll({ multiple: true })), mine: ['o1', 'o2'] });
    render(<PollCard message={message(poll({ multiple: true }))} />);
    fireEvent.click(screen.getByRole('button', { name: /Belgrade/ }));
    await waitFor(() => expect(vote).toHaveBeenCalledWith('m1', ['o1', 'o2']));
    expect(screen.getByText('Choose any')).toBeTruthy();
  });

  it('lets whoever asked close it, and nobody else', async () => {
    as('ana');
    const close = vi
      .spyOn(api.messages, 'closePoll')
      .mockResolvedValue({ message: message(poll({ closedAt: '2026-10-22T11:00:00.000Z' })) });
    render(<PollCard message={message(poll())} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close poll' }));
    await waitFor(() => expect(close).toHaveBeenCalledWith('m1'));
    cleanup();

    as('bo');
    render(<PollCard message={message(poll())} />);
    expect(screen.queryByRole('button', { name: 'Close poll' })).toBeNull();
  });
});

describe('an anonymous poll', () => {
  it('names nobody, and asks for your own choice apart', async () => {
    as('bo');
    const mine = vi.spyOn(api.messages, 'myVote').mockResolvedValue({ mine: ['o2'] });
    const anonymous = poll({
      anonymous: true,
      options: [
        { id: 'o1', text: 'Lisbon', count: 1, voterIds: null },
        { id: 'o2', text: 'Belgrade', count: 1, voterIds: null },
      ],
    });
    render(<PollCard message={message(anonymous)} />);
    const belgrade = screen.getByRole('button', { name: /Belgrade/ });
    await waitFor(() => expect(belgrade.getAttribute('aria-pressed')).toBe('true'));
    expect(mine).toHaveBeenCalledWith('m1');
    expect(belgrade.getAttribute('title')).toBeNull();
    expect(screen.getByText('Anonymous')).toBeTruthy();
  });
});

describe('a closed poll', () => {
  it('shows how it stood and takes no votes', () => {
    as('ana');
    render(<PollCard message={message(poll({ closedAt: '2026-10-22T11:00:00.000Z' }))} />);
    expect((screen.getByRole('button', { name: /Lisbon/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText('Closed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close poll' })).toBeNull();
  });
});
