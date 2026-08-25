// @vitest-environment happy-dom
/** Group changes arriving over the socket.
 *
 * Without these three frames a tab open since before a group was created renders
 * `@platform-team` as plain text for ever: the handle is only known from the boot
 * payload, and `resync()` does not refetch groups on reconnect either. Only a full page
 * load would have picked it up, which is exactly the kind of staleness nobody reports
 * because it looks like the feature simply not working.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerEvent, UserGroup } from '@blob/shared';

vi.mock('./socket.ts', () => ({
  socket: { send: vi.fn(), connect: vi.fn(), close: vi.fn(), onEvent: vi.fn(), onStatus: vi.fn() },
}));

const { useStore } = await import('./store.ts');

const platform: UserGroup = {
  id: 'g1',
  handle: 'platform-team',
  name: 'Platform Team',
  description: null,
  memberCount: 3,
};

const apply = (event: ServerEvent) => useStore.getState().applyEvent(event);
const groups = () => useStore.getState().groups;
const mine = () => [...useStore.getState().myGroupIds];

beforeEach(() => {
  useStore.setState({ groups: {}, myGroupIds: new Set<string>() });
});

describe('a group arriving or changing', () => {
  it('shows up without a reload', () => {
    apply({ t: 'group.upserted', group: platform });
    expect(groups()['g1']?.handle).toBe('platform-team');
  });

  it('replaces the one it already had', () => {
    apply({ t: 'group.upserted', group: platform });
    apply({ t: 'group.upserted', group: { ...platform, handle: 'platform', memberCount: 4 } });

    expect(groups()['g1']?.handle).toBe('platform');
    expect(groups()['g1']?.memberCount).toBe(4);
    // Renaming replaces rather than adding, or the old handle would keep resolving.
    expect(Object.keys(groups())).toEqual(['g1']);
  });
});

describe('a group going away', () => {
  it('stops being mentionable', () => {
    apply({ t: 'group.upserted', group: platform });
    apply({ t: 'group.deleted', groupId: 'g1' });
    expect(groups()).toEqual({});
  });

  it('takes your membership with it', () => {
    apply({ t: 'group.upserted', group: platform });
    apply({ t: 'group.membership', groupId: 'g1', isMember: true });
    apply({ t: 'group.deleted', groupId: 'g1' });

    // Left behind, it would keep marking old messages as mentioning you — for a group
    // that no longer exists and no longer appears anywhere to explain why.
    expect(mine()).toEqual([]);
  });
});

describe('being added to or removed from one', () => {
  it('starts counting mentions as yours', () => {
    apply({ t: 'group.membership', groupId: 'g1', isMember: true });
    expect(mine()).toEqual(['g1']);
  });

  it('stops counting them when you are taken out', () => {
    apply({ t: 'group.membership', groupId: 'g1', isMember: true });
    apply({ t: 'group.membership', groupId: 'g2', isMember: true });
    apply({ t: 'group.membership', groupId: 'g1', isMember: false });

    expect(mine()).toEqual(['g2']);
  });

  it('is idempotent, because a reconnect can replay one', () => {
    apply({ t: 'group.membership', groupId: 'g1', isMember: true });
    apply({ t: 'group.membership', groupId: 'g1', isMember: true });
    expect(mine()).toEqual(['g1']);
  });
});
