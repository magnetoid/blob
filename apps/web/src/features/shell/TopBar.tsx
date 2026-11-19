/**
 * The bar across the top: the channel list's trigger, workspace, search, and the account
 * menu at the right.
 *
 * Slack puts your avatar in the top-right corner and hangs the account menu off it, so
 * that is where this lives. The bar spans every column of the shell, which is what makes
 * the menu reachable from the conversation, search, preferences and administration
 * alike — a menu that only existed in one view would be a menu people could lose.
 *
 * The chat shell keeps the bar sparse (list trigger, team, search, invite, this menu); the
 * places a person goes — Activity, Files, Channels — are rows in the channel list, not
 * tabs here. The consoles keep a two-button switcher back to Messages and Search and a
 * Feedback button; preferences and the server's pages are reached from the account menu
 * alone. The account control is in the corner in both, never down in the channel list.
 *
 * The bar is first-load code. Its two menus are modules (`AccountMenu`, `WorkspaceMenu`)
 * fetched beside the overlay chunk through `lazyDropdown`, so nothing here imports Base
 * UI's menu.
 */

import { useState } from 'react';
import { PanelLeftIcon } from 'lucide-react';
import { useStore } from '../../lib/store.ts';
import { navigate, pathForView, usePath, type View } from '../../lib/router.ts';
import { Avatar } from '../../components/Avatar.tsx';
import { lazyDropdown } from '../../components/lazyDropdown.tsx';
import { Button } from '../../components/ui/button.tsx';
import { useSidebar } from '../../components/ui/sidebar.tsx';
import { WorkspaceSwitcher } from './WorkspaceSwitcher.tsx';
import {
  ChevronDownIcon,
  FeedbackIcon,
  MembersIcon,
  MessagesIcon,
  SearchIcon,
} from '../../components/Icon.tsx';
import { hasUnseenRelease } from '../../lib/changelog.ts';

const AccountMenuLazy = lazyDropdown(() => import('./AccountMenu.tsx'));

interface Props {
  onFeedback: () => void;
  /** The whole app's view, so a screen the bar cannot reach simply presses nothing. */
  view: View;
  /** The chat shell keeps the bar intentionally sparse, and draws the channel list's trigger. */
  minimal?: boolean;
  /** Open the palette instead of navigating to the search page.
   *
   * The bar's search button used to leave the conversation to answer a question about
   * it, which is the one thing a reader looking something up does not want. Where a
   * palette is mounted it takes the click; the console has none, so there the button
   * still navigates and nothing has to know why.
   */
  onSearch?: () => void;
  /** Draw the workspace mark and switcher here. True everywhere: the bar spans the list
   * and the conversation, and a name that names the whole app belongs above the whole app. */
  brand?: boolean;
}

export function TopBar({ onFeedback, view, minimal = false, brand = true, onSearch }: Props) {
  const currentUser = useStore((s) => s.currentUser);
  const workspaceName = useStore((s) => s.workspaceName);

  if (!currentUser) return null;

  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'owner';
  const search = () => (onSearch ? onSearch() : navigate(pathForView('search')));

  return (
    <header
      data-slot="topbar"
      className="col-span-full flex min-w-0 items-center gap-1.5 bg-sidebar px-2 pt-[env(safe-area-inset-top)] text-sidebar-foreground md:gap-3 md:pr-3 md:pl-4"
    >
      {minimal && <ListTrigger />}

      {brand && (
        <div className="flex min-w-0 items-center gap-2">
          {/* The initial on the accent, so a workspace is recognisable before its name is
              read — and the only part of identity a narrow bar keeps. Not a control: what
              folds the list is the button beside it. */}
          <span
            aria-hidden="true"
            className="grid size-6 flex-none place-items-center rounded-md bg-(--blob-accent) text-sm leading-none font-bold text-(--blob-accent-contrast) select-none"
          >
            {workspaceName.trim().charAt(0).toUpperCase() || 'B'}
          </span>
          <WorkspaceSwitcher name={workspaceName} />
        </div>
      )}

      {minimal ? (
        <>
          <div className="flex min-w-0 flex-1 justify-center">
            <Button
              variant="outline"
              className="h-8 w-full max-w-md min-w-0 gap-2 rounded-full bg-card px-3.5 text-muted-foreground shadow-xs"
              aria-pressed={view === 'search'}
              onClick={search}
              title="Search"
            >
              <SearchIcon size="lg" />
              <span>Search</span>
            </Button>
          </div>
          {isAdmin && (
            <Button
              variant="ghost"
              className="text-muted-foreground max-md:w-8 max-md:px-0"
              onClick={() => navigate('/admin/invitations')}
              aria-label="Invite people"
              title="Invite people"
            >
              <MembersIcon size="md" />
              <span className="max-md:sr-only">Invite</span>
            </Button>
          )}
        </>
      ) : (
        <>
          <nav aria-label="Views" className="flex items-center gap-0.5 md:ml-2">
            <Button
              variant="ghost"
              className="aria-pressed:bg-sidebar-accent aria-pressed:text-primary max-md:w-8 max-md:px-0"
              aria-pressed={view === 'messages' || view === 'channel'}
              onClick={() => navigate(pathForView('messages'))}
              title="Messages"
            >
              <MessagesIcon size="lg" />
              <span className="max-md:sr-only">Messages</span>
            </Button>
            <Button
              variant="ghost"
              className="aria-pressed:bg-sidebar-accent aria-pressed:text-primary max-md:w-8 max-md:px-0"
              aria-pressed={view === 'search'}
              onClick={search}
              title="Search"
            >
              <SearchIcon size="lg" />
              <span className="max-md:sr-only">Search</span>
            </Button>
          </nav>
          <div className="flex-1" />
          <Button
            variant="ghost"
            className="text-muted-foreground max-md:w-8 max-md:px-0"
            onClick={onFeedback}
            title="Report a bug or send feedback"
          >
            <FeedbackIcon size="md" />
            <span className="max-md:sr-only">Feedback</span>
          </Button>
        </>
      )}

      <AccountControl onFeedback={onFeedback} />
    </header>
  );
}

/**
 * The channel list's trigger, in the chat shell's bar only: the consoles have a provider
 * of their own for their section nav, and this would talk to that one. Below 768px it
 * opens the Sheet; from 768px it folds the list to its rail.
 */
function ListTrigger() {
  const { isMobile, open, setOpen, openMobile, setOpenMobile, openerRef } = useSidebar();
  const expanded = isMobile ? openMobile : open;
  const label = isMobile
    ? openMobile
      ? 'Close channel list'
      : 'Open channel list'
    : open
      ? 'Hide channel list'
      : 'Show channel list';

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="flex-none"
      aria-label={label}
      aria-expanded={expanded}
      title={label}
      onClick={(event) => {
        // Where focus goes back to when the Sheet closes: the dialog's own default is
        // whatever had focus before it opened, and Safari does not focus a button that is
        // clicked, so there it was the page.
        openerRef.current = event.currentTarget;
        if (isMobile) setOpenMobile(!openMobile);
        else setOpen(!open);
      }}
    >
      <PanelLeftIcon />
    </Button>
  );
}

function AccountControl({ onFeedback }: { onFeedback: () => void }) {
  const currentUser = useStore((s) => s.currentUser);
  const status = useStore((s) => s.status);
  const path = usePath();

  // Read once and cleared on arrival, in a render-phase adjustment: the page marks itself
  // read in an effect, so re-reading storage here would race it.
  const [unseenRelease, setUnseenRelease] = useState(hasUnseenRelease);
  if (unseenRelease && path === '/whats-new') setUnseenRelease(false);

  if (!currentUser) return null;

  return (
    <AccountMenuLazy
      onFeedback={onFeedback}
      unseenRelease={unseenRelease}
      trigger={
        <Button variant="ghost" className="flex-none gap-2 pr-1.5 pl-1" title={currentUser.displayName}>
          <span className="relative flex">
            <Avatar user={currentUser} size="sm" />
            <span
              className="presence-dot"
              data-state={status === 'online' ? 'active' : 'offline'}
              title={status === 'online' ? 'Connected' : 'Reconnecting…'}
            />
          </span>
          {/* Visible from 768px; below it the avatar is what people aim at, and the name
              stays the button's accessible name. */}
          <span className="max-w-40 truncate max-md:sr-only">{currentUser.displayName}</span>
          {/* A quiet mark, not a count: there is nothing to act on, only something to
              read, and a red badge would make release notes feel like an unread DM. */}
          {unseenRelease && (
            <span className="size-1.5 flex-none rounded-full bg-(--blob-accent)" aria-hidden="true" />
          )}
          <ChevronDownIcon size="sm" className="text-muted-foreground max-md:hidden" />
        </Button>
      }
    />
  );
}
