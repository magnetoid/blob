/** What `@something` in a message body refers to.
 *
 * One index, built once, used by every renderer. `MessageRow` and `PinnedPanel` each had
 * their own copy of "lowercase every display name into a Map", which is how a pinned
 * message ended up showing plain text where the channel showed a chip — two builds of the
 * same idea, and only one of them learned about anything new.
 *
 * Mirrors the server's `workspace_handles`: one namespace holding people and groups
 * together, which is what makes a mention unambiguous. Users are inserted first and
 * groups only into free keys, so that even if the server's guarantee were ever broken the
 * client picks the same winner every time rather than whichever happened to be last.
 */

import { useMemo } from 'react';
import { useStore } from '../../lib/store.ts';

export interface MentionTarget {
  kind: 'user' | 'group';
  id: string;
  /** Whether this mention is about the person reading it — you, or a team you are on. */
  isMe: boolean;
}

export function useMentionIndex(): Map<string, MentionTarget> {
  const users = useStore((s) => s.users);
  const groups = useStore((s) => s.groups);
  const myGroupIds = useStore((s) => s.myGroupIds);
  const currentUserId = useStore((s) => s.currentUser?.id ?? null);

  return useMemo(() => {
    const index = new Map<string, MentionTarget>();
    for (const user of Object.values(users)) {
      index.set(user.displayName.toLowerCase(), {
        kind: 'user',
        id: user.id,
        isMe: user.id === currentUserId,
      });
    }
    for (const group of Object.values(groups)) {
      // Only into a free key. The server cannot produce a collision; this makes the
      // client's behaviour defined rather than incidental if that ever changed.
      if (index.has(group.handle)) continue;
      index.set(group.handle, {
        kind: 'group',
        id: group.id,
        isMe: myGroupIds.has(group.id),
      });
    }
    return index;
  }, [users, groups, myGroupIds, currentUserId]);
}
