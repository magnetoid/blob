// @vitest-environment happy-dom
/**
 * The order the `@` list offers names in.
 *
 * The first row is what Enter takes, so the order is who gets notified. What these pin,
 * in the picker's own words: what you typed decides first; among equal matches, people
 * in this conversation before people who are not — only members are notified — then
 * whom you tagged last, then the alphabet; people before groups; and `@channel` and
 * `@here` last, so a broadcast is never the default.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import type { ServerEvent } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { useMentionAutocomplete } from './useMentionAutocomplete.ts';

function person(id: string, displayName: string) {
  return { id, kind: 'human', displayName, fullName: null, deactivated: false, agentDisabled: false };
}

function group(id: string, handle: string) {
  return { id, handle, name: handle, description: null, memberCount: 2 };
}

function seed({
  people,
  groups = [],
  recentPeople = [],
  recentGroups = [],
  members,
}: {
  people: ReturnType<typeof person>[];
  groups?: ReturnType<typeof group>[];
  recentPeople?: string[];
  recentGroups?: string[];
  /** What the channel view fetched for #general, if it has. */
  members?: string[];
}) {
  const me = person('me', 'Me Myself');
  useStore.setState({
    currentUser: { ...me, role: 'member', prefs: {} },
    users: Object.fromEntries([me, ...people].map((u) => [u.id, u])),
    groups: Object.fromEntries(groups.map((g) => [g.id, g])),
    channels: {
      c1: { id: 'c1', kind: 'public', name: 'general', memberIds: null, lastMessageId: null },
      d1: { id: 'd1', kind: 'dm', name: null, memberIds: ['me', 'zoe'], lastMessageId: null },
    },
    membershipVersion: {},
    channelMembers: members ? { c1: { version: 0, userIds: members } } : {},
    messages: {},
    threads: {},
    outbox: {},
    activeChannelId: null,
    recentMentionUserIds: recentPeople,
    recentMentionGroupIds: recentGroups,
    recentMentionsAsOf: null,
  } as never);
}

/** Type `@` and whatever follows it, the way the composer reports an edit. */
function openPicker(typed = '', channelId = 'c1') {
  const textarea = { current: null };
  const setDraft = vi.fn();
  const hook = renderHook(() => useMentionAutocomplete(`@${typed}`, setDraft, textarea, channelId));
  act(() => {
    hook.result.current.track(`@${typed}`);
  });
  return { ...hook, setDraft };
}

const labels = (hook: ReturnType<typeof openPicker>) =>
  hook.result.current.candidates.map((candidate) => candidate.label);

const highlighted = (hook: ReturnType<typeof openPicker>) =>
  hook.result.current.candidates[hook.result.current.index]?.label;

function press(hook: ReturnType<typeof openPicker>, key: string) {
  act(() => {
    hook.result.current.handleKey({
      key,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent<HTMLTextAreaElement>);
  });
}

let fetchMembers: MockInstance<typeof api.channels.members>;

beforeEach(() => {
  // The list reads what the channel view already fetched. Asking again from here is the
  // request that used to land while the list was open and re-sort it under the
  // highlight, so any call at all is a failure.
  fetchMembers = vi.spyOn(api.channels, 'members');
});

afterEach(() => {
  expect(fetchMembers).not.toHaveBeenCalled();
  cleanup();
  vi.restoreAllMocks();
});

describe('whom you tagged last', () => {
  it('leads a bare @, ahead of names the alphabet puts first', () => {
    seed({
      people: [person('ana', 'Ana Petrov'), person('bruno', 'Bruno Silva'), person('zoe', 'Zoe Hart')],
      recentPeople: ['zoe'],
    });

    expect(labels(openPicker())).toEqual(['Zoe Hart', 'Ana Petrov', 'Bruno Silva', 'channel', 'here']);
  });

  it('outranks an alphabetically earlier name that matches just as well', () => {
    seed({
      people: [person('maja', 'Maja Kovac'), person('marko', 'Marko Ilic')],
      recentPeople: ['marko'],
    });

    expect(labels(openPicker('ma'))).toEqual(['Marko Ilic', 'Maja Kovac']);
  });

  it('never outranks a better match for what was typed', () => {
    // "ra" starts Radek's name and only Priya's surname.
    seed({
      people: [person('priya', 'Priya Raman'), person('radek', 'Radek Novak')],
      recentPeople: ['priya'],
    });

    expect(labels(openPicker('ra'))).toEqual(['Radek Novak', 'Priya Raman']);
  });

  it('orders groups the same way', () => {
    seed({
      people: [],
      groups: [group('g1', 'design'), group('g2', 'platform')],
      recentGroups: ['g2'],
    });

    expect(labels(openPicker())).toEqual(['platform', 'design', 'channel', 'here']);
  });
});

describe('who is in the conversation', () => {
  it('comes before who is not', () => {
    seed({ people: [person('ana', 'Ana Petrov'), person('bruno', 'Bruno Silva')], members: ['me', 'bruno'] });

    expect(labels(openPicker())).toEqual(['Bruno Silva', 'Ana Petrov', 'channel', 'here']);
  });

  it('comes before a non-member you tagged last', () => {
    // Only members are notified, so the name Enter takes has to be somebody the mention
    // reaches. Recency still decides — among the people it can reach.
    seed({
      people: [person('ana', 'Ana Petrov'), person('bruno', 'Bruno Silva'), person('cleo', 'Cleo Dunn')],
      recentPeople: ['ana'],
      members: ['me', 'bruno', 'cleo'],
    });

    expect(labels(openPicker())).toEqual(['Bruno Silva', 'Cleo Dunn', 'Ana Petrov', 'channel', 'here']);
  });

  it('is ordered by whom you tagged last among themselves', () => {
    seed({
      people: [person('ana', 'Ana Petrov'), person('bruno', 'Bruno Silva'), person('cleo', 'Cleo Dunn')],
      recentPeople: ['cleo', 'ana'],
      members: ['me', 'bruno', 'cleo'],
    });

    expect(labels(openPicker())).toEqual(['Cleo Dunn', 'Bruno Silva', 'Ana Petrov', 'channel', 'here']);
  });

  it('is still the fetched list after somebody joins', () => {
    // A channel's `memberIds` is null on the wire, and a join frame used to turn it into
    // a list of one — the joiner — which the picker then took for the whole room.
    seed({
      people: [person('ana', 'Ana Petrov'), person('bruno', 'Bruno Silva'), person('cleo', 'Cleo Dunn')],
      members: ['me', 'bruno'],
    });
    act(() => {
      useStore.getState().applyEvent({ t: 'member.joined', channelId: 'c1', userId: 'cleo' } as ServerEvent);
    });

    // Bruno from the list the channel view fetched; Cleo waits for its next fetch rather
    // than being taken for the only member there is.
    expect(labels(openPicker())).toEqual(['Bruno Silva', 'Ana Petrov', 'Cleo Dunn', 'channel', 'here']);
  });

  it('is never read off a channel’s own memberIds', () => {
    // What the join frame used to leave behind. Only a DM's list is the channel's own;
    // anywhere else the fetched list is the room.
    seed({
      people: [person('ana', 'Ana Petrov'), person('bruno', 'Bruno Silva'), person('cleo', 'Cleo Dunn')],
      members: ['me', 'bruno'],
    });
    act(() => {
      useStore.setState((s) => ({
        channels: { ...s.channels, c1: { ...s.channels.c1!, memberIds: ['cleo'] } },
      }));
    });

    expect(labels(openPicker())[0]).toBe('Bruno Silva');
  });

  it('is already known in a DM', () => {
    seed({ people: [person('ana', 'Ana Petrov'), person('zoe', 'Zoe Hart')] });

    expect(labels(openPicker('', 'd1'))).toEqual(['Zoe Hart', 'Ana Petrov', 'channel', 'here']);
  });
});

describe('the highlight', () => {
  it('stays on the person it was on when the list re-sorts, and Enter takes them', () => {
    seed({ people: [person('ana', 'Ana Petrov'), person('bruno', 'Bruno Silva'), person('cleo', 'Cleo Dunn')] });
    const picker = openPicker();
    press(picker, 'ArrowDown');
    expect(highlighted(picker)).toBe('Bruno Silva');

    // The member list lands while the list is open, and Cleo moves to the top.
    act(() => useStore.getState().setChannelMembers('c1', 0, ['me', 'cleo']));
    expect(labels(picker)).toEqual(['Cleo Dunn', 'Ana Petrov', 'Bruno Silva', 'channel', 'here']);

    expect(highlighted(picker)).toBe('Bruno Silva');
    press(picker, 'Enter');
    expect(picker.setDraft).toHaveBeenCalledWith('@Bruno Silva ');
  });
});

describe('the kinds', () => {
  it('put people first, then groups, and the two broadcasts last', () => {
    seed({
      people: [person('hana', 'Hana Ito')],
      groups: [group('g1', 'hr')],
    });

    // All three start with "h", and "here" is the shortest, whole-word match of them.
    // It is still last: the first row is what Enter takes, and a broadcast is the one
    // mention that must never be taken by default.
    expect(labels(openPicker('h'))).toEqual(['Hana Ito', 'hr', 'here']);
  });
});

describe('a mention you just made', () => {
  it('moves to the front without a reload', () => {
    seed({
      people: [person('ana', 'Ana Petrov'), person('bruno', 'Bruno Silva'), person('cleo', 'Cleo Dunn')],
      groups: [group('g1', 'design'), group('g2', 'platform')],
    });
    const picker = openPicker();
    expect(labels(picker)).toEqual([
      'Ana Petrov',
      'Bruno Silva',
      'Cleo Dunn',
      'design',
      'platform',
      'channel',
      'here',
    ]);

    act(() => {
      useStore.getState().applyEvent({
        t: 'message.new',
        message: {
          id: 'm1',
          channelId: 'c1',
          authorId: 'me',
          kind: 'user',
          body: '@Cleo Dunn and @platform, over to you',
          threadRootId: null,
          alsoInChannel: false,
          mentionUserIds: ['cleo'],
          mentionGroupIds: ['g2'],
          mentionsEveryone: false,
          deletedAt: null,
        },
      } as unknown as ServerEvent);
    });

    expect(labels(picker)).toEqual([
      'Cleo Dunn',
      'Ana Petrov',
      'Bruno Silva',
      'platform',
      'design',
      'channel',
      'here',
    ]);
  });
});
