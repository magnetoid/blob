/** Who somebody is, and the button that starts a conversation with them.
 *
 * Until this existed, two places in the whole client could open a direct message: the
 * sidebar row and ⌘K. Clicking a person's name or avatar on a message — the gesture
 * every chat app has trained people to make — did nothing at all.
 *
 * A popover, and not the menu it was drawn as: who somebody is, and one thing to do about
 * it, is a dialog with a button in it rather than a list of items. Built on `Popover`, which
 * shares the menus' dismissal contract (outside click, Escape through the stack, focus
 * leaving) rather than hand-rolling a fourth copy of what three separate ones got subtly
 * wrong before. Its panel is shadcn's popover from the overlay chunk; what is drawn in it is
 * here, in shadcn's popover layout — a header of name and details, and an outline button.
 */

import { useState } from 'react';
import type { User } from '@blob/shared';
import { Popover } from './Popover.tsx';
import { Avatar } from './Avatar.tsx';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/store.ts';
import { showError } from '../lib/toasts.ts';
import { showChannel } from '../lib/navigation.ts';
import { useFetch } from '../lib/useFetch.ts';

/** shadcn's `PopoverContent` layout, on the card. */
const CARD = 'flex w-72 flex-col gap-2.5 p-2.5 text-sm';

/**
 * shadcn's outline `Button`, the whole width of the card, written out rather than imported:
 * `components/ui/button.tsx` brings `cn` into the first load, and whether it may is the next
 * task's to measure. 44px under a coarse pointer, as every control here is.
 */
const MESSAGE = [
  'inline-flex h-8 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border',
  'bg-background px-2.5 text-sm font-medium whitespace-nowrap transition-all outline-none select-none',
  'hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
  'disabled:pointer-events-none disabled:opacity-50',
  'dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
  'pointer-coarse:min-h-11',
].join(' ');

export function PersonCard({
  person,
  open,
  onClose,
}: {
  person: User;
  open: boolean;
  onClose: () => void;
}) {
  const currentUser = useStore((s) => s.currentUser);
  const live = useStore((s) => s.users[person.id]) ?? person;
  const [busy, setBusy] = useState(false);
  const isMe = person.id === currentUser?.id;

  // The full profile, read when the card opens and folded into the store, which is
  // where `live` above reads it back from. A failure leaves the summary row's copy.
  useFetch(
    async () => {
      if (!open) return null;
      const { user } = await api.users.get(person.id);
      useStore.setState((s) => ({ users: { ...s.users, [user.id]: { ...s.users[user.id], ...user } } }));
      return user;
    },
    [open, person.id],
  );

  async function message() {
    if (busy) return;
    setBusy(true);
    try {
      const { channel } = await api.dms.open([person.id]);
      useStore.setState((s) => ({ channels: { ...s.channels, [channel.id]: channel } }));
      onClose();
      await showChannel(channel.id);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onClose={onClose} label={live.displayName} className={CARD}>
      <div className="flex items-center gap-2.5 border-b border-border pb-2.5">
        {/* Legacy markup until the avatar is shadcn's: an island, so the preflight repair
            still reaches it inside shadcn's popup (`styles/app/base.css`). */}
        <span data-legacy="" className="contents">
          <Avatar user={live} size="lg" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="truncate font-medium">{live.displayName}</div>
          {live.fullName && live.fullName !== live.displayName && (
            <div className="text-muted-foreground">{live.fullName}</div>
          )}
          {live.title && <div className="text-muted-foreground">{live.title}</div>}
          {live.timezone && live.timezone !== 'UTC' && (
            <div className="text-muted-foreground">{live.timezone}</div>
          )}
          {(live.statusEmoji || live.statusText) && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              {live.statusEmoji && <span>{live.statusEmoji}</span>}
              {live.statusText && <span>{live.statusText}</span>}
            </div>
          )}
        </div>
      </div>

      {/* A conversation with yourself is a real place — it is where /remind writes — but
          "Message" on your own name reads as a mistake, so the card says what it is. */}
      <button type="button" className={MESSAGE} disabled={busy} onClick={() => void message()}>
        {isMe ? 'Open your own messages' : `Message ${live.displayName}`}
      </button>
    </Popover>
  );
}
