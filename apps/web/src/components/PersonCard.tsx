/** Who somebody is, and the button that starts a conversation with them, as a module of its
 * own (`features/messages/lazyPopups.ts`): shadcn's Popover, which is Base UI's, so a click
 * outside, Escape and focus going back to the name are all its own. The author's name is
 * handed in as `trigger` and is the popover's own button.
 *
 * Until this existed, two places in the whole client could open a direct message: the
 * sidebar row and ⌘K. Clicking a person's name on a message — the gesture every chat app
 * has trained people to make — did nothing at all.
 *
 * A popover, and not a menu: who somebody is, and one thing to do about it, is a dialog with
 * a button in it rather than a list of items. While open it holds its place on the Escape
 * stack (`lib/useMenuEscapeLayer.ts`), so that Escape is the card's and not the thread's or
 * the file panel's behind it. The card is drawn only once somebody presses a name
 * (`mount: 'press'`): a virtualised channel mounts rows on every scroll, and most names are
 * never pressed.
 */

import { useState } from 'react';
import type { User } from '@blob/shared';
import { useMenuEscapeLayer } from '../lib/useMenuEscapeLayer.ts';
import type { TriggerModuleProps } from './lazyTrigger.tsx';
import { Button } from './ui/button.tsx';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.tsx';
import { Avatar } from './Avatar.tsx';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/store.ts';
import { showError } from '../lib/toasts.ts';
import { showChannel } from '../lib/navigation.ts';
import { useFetch } from '../lib/useFetch.ts';

export interface PersonCardProps extends TriggerModuleProps {
  /** The summary row the caller has; the store's fuller copy replaces it once fetched. */
  person: User;
}

export default function PersonCard({ trigger, defaultOpen, person }: PersonCardProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const { popupRef, triggerRef } = useMenuEscapeLayer(open, setOpen);
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
      setOpen(false);
      await showChannel(channel.id);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger ref={triggerRef} render={trigger} />
      <PopoverContent ref={popupRef} align="start" aria-label={live.displayName}>
        <div className="flex items-center gap-2.5 border-b border-border pb-2.5">
          <Avatar user={live} size="lg" />
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
        <Button variant="outline" className="w-full" disabled={busy} onClick={() => void message()}>
          {isMe ? 'Open your own messages' : `Message ${live.displayName}`}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
