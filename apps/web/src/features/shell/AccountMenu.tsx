/**
 * The account menu's content, as a module the top bar fetches beside the overlay chunk.
 *
 * `lazyDropdown` hands it the button that opens it and whether it opens as it is drawn
 * (`components/lazyDropdown.tsx`); the menu itself is shadcn's, so Base UI owns the
 * trigger, the arrows and typeahead, Escape, and focus going back to the button. Which
 * rows there are is `menu.ts`'s, and who may see each is the viewer's role.
 *
 * Two things here are Blob's. Feedback does not run when its row is chosen but when the
 * menu has finished closing: the report's snapshot is of the page behind the menu, and a
 * menu still fading over it is in the picture. And the menu closes on a change of path,
 * so a navigation that did not come from a row (Back, a link in the page) does not leave
 * it open behind the new screen.
 */

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../lib/store.ts';
import { navigate, usePath } from '../../lib/router.ts';
import type { DropdownModuleProps } from '../../components/lazyDropdown.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import { ITEMS } from './menu.ts';

interface Props extends DropdownModuleProps {
  onFeedback: () => void;
  /** A release the person has not looked at: What's new carries a dot while it is true. */
  unseenRelease: boolean;
}

export default function AccountMenu({ trigger, defaultOpen, onFeedback, unseenRelease }: Props) {
  const currentUser = useStore((s) => s.currentUser);
  const path = usePath();
  const [open, setOpen] = useState(defaultOpen ?? false);
  /** Feedback was chosen and is waiting for the menu to finish closing. */
  const feedbackPending = useRef(false);
  /** The frame Feedback is waiting for, so leaving the page cancels it. */
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // Adjusted during render rather than in an effect, which avoids the extra pass.
  const [menuPath, setMenuPath] = useState(path);
  if (menuPath !== path) {
    setMenuPath(path);
    setOpen(false);
  }

  if (!currentUser) return trigger;

  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'owner';
  const isOwner = currentUser.role === 'owner';
  const visible = ITEMS.filter(
    (item) =>
      (!item.adminOnly || isAdmin) &&
      (!item.ownerOnly || isOwner) &&
      (!item.instanceOnly || currentUser.isInstanceAdmin),
  );

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(complete) => {
        if (complete || !feedbackPending.current) return;
        feedbackPending.current = false;
        // The completion is called as the popup finishes its exit, a frame before React has
        // taken it off the page: one more frame, and the snapshot is of the page alone.
        frame.current = requestAnimationFrame(onFeedback);
      }}
    >
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align="end" sideOffset={6} className="w-auto min-w-58">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5 px-2 py-1.5">
            <span className="truncate text-sm font-semibold text-foreground">
              {currentUser.displayName}
            </span>
            <span className="truncate text-xs font-normal">{currentUser.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {visible.map((item) =>
          item.soon ? (
            <DropdownMenuItem key={item.label} disabled title="Not built yet">
              {item.label}
              <span className="ml-auto text-xs text-muted-foreground">Soon</span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              key={item.label}
              className="pointer-coarse:min-h-11"
              onClick={() => {
                if (item.action === 'feedback') feedbackPending.current = true;
                else navigate(item.path as string);
              }}
            >
              {item.label}
              {item.path === '/whats-new' && unseenRelease && (
                <span
                  role="img"
                  className="ml-auto size-1.5 rounded-full bg-(--blob-accent)"
                  aria-label="New since you last looked"
                />
              )}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
