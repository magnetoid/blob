/**
 * The bar across the top: workspace, view switching, and the user menu at the right.
 *
 * Slack puts your avatar in the top-right corner and hangs the account menu off it, so
 * that is where this lives. The bar spans every column of the shell, which is what makes
 * the menu reachable from the conversation, search, preferences and administration
 * alike — a menu that only existed in one view would be a menu people could lose.
 *
 * The chat shell keeps the bar sparse (team + search + this menu). Preferences and
 * administration keep the view switcher in the same row. The account control is in the
 * corner in both, never down in the channel list.
 */

import { useState } from 'react';
import { useStore } from '../../lib/store.ts';
import { navigate, pathForRoute, pathForView, usePath, type View } from '../../lib/router.ts';
import { Avatar } from '../../components/Avatar.tsx';
import { Menu } from '../../components/Menu.tsx';
import { WorkspaceSwitcher } from './WorkspaceSwitcher.tsx';
import {
  ChevronDownIcon,
  FeedbackIcon,
  HuddleIcon,
  MembersIcon,
  MessagesIcon,
  SearchIcon,
  MenuIcon,
  SettingsIcon,
} from '../../components/Icon.tsx';
import { ITEMS } from './menu.ts';
import { hasUnseenRelease } from '../../lib/changelog.ts';

interface Props {
  onFeedback: () => void;
  /** Narrow viewports only (CSS hides it elsewhere): opens the channel drawer. */
  onToggleSidebar?: () => void;
  /** The whole app's view, so a screen the bar cannot reach simply presses nothing. */
  view: View;
  /** The chat shell keeps the bar intentionally sparse. */
  minimal?: boolean;
}

export function TopBar({ onFeedback, onToggleSidebar, view, minimal = false }: Props) {
  const currentUser = useStore((s) => s.currentUser);
  const workspaceName = useStore((s) => s.workspaceName);

  if (!currentUser) return null;

  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'owner';

  return (
    <header className={minimal ? 'topbar topbar-minimal' : 'topbar'}>
      {onToggleSidebar && (
        <button
          type="button"
          className="topbar-hamburger"
          aria-label="Channels"
          onClick={onToggleSidebar}
        >
          <MenuIcon size="lg" />
        </button>
      )}
      <WorkspaceSwitcher name={workspaceName} />

      {minimal && (
        <nav className="topbar-tabs" aria-label="Workspace">
          <button
            type="button"
            className="topbar-tab"
            aria-pressed={
              view === 'messages' || view === 'channel' || view === 'home' || view === 'threads'
            }
            onClick={() => navigate(pathForView('messages'))}
          >
            Messages
          </button>
          <button
            type="button"
            className="topbar-tab"
            aria-pressed={view === 'activity'}
            onClick={() => navigate(pathForView('activity'))}
          >
            Activity
          </button>
          <button
            type="button"
            className="topbar-tab"
            disabled
            title="Files arrive in a later release"
          >
            Files
          </button>
          <button
            type="button"
            className="topbar-tab"
            aria-pressed={view === 'browse'}
            onClick={() => navigate(pathForView('browse'))}
          >
            Channels
          </button>
        </nav>
      )}

      {!minimal && (
        <nav className="topbar-nav" aria-label="Views">
          <button
            className="topbar-nav-btn"
            aria-pressed={view === 'messages' || view === 'channel'}
            onClick={() => navigate(pathForView('messages'))}
            aria-label="Messages"
            data-tooltip="Messages"
          >
            <MessagesIcon size="lg" />
            <span className="topbar-nav-label">Messages</span>
          </button>
          <button
            className="topbar-nav-btn"
            aria-pressed={view === 'search'}
            onClick={() => navigate(pathForView('search'))}
            aria-label="Search"
            data-tooltip="Search"
          >
            <SearchIcon size="lg" />
            <span className="topbar-nav-label">Search</span>
          </button>
          {isAdmin && (
            <button
              className="topbar-nav-btn"
              aria-pressed={view === 'admin'}
              onClick={() => navigate(pathForView('admin'))}
              aria-label="Administration"
              data-tooltip="Administration"
            >
              <MembersIcon size="lg" />
              <span className="topbar-nav-label">Admin</span>
            </button>
          )}
          <button
            className="topbar-nav-btn"
            aria-pressed={view === 'settings'}
            onClick={() => navigate(pathForRoute({ view: 'settings', section: 'preferences' }))}
            aria-label="Preferences"
            data-tooltip="Preferences"
          >
            <SettingsIcon size="lg" />
            <span className="topbar-nav-label">Preferences</span>
          </button>
        </nav>
      )}

      {minimal ? (
        <>
          <div className="topbar-spacer" />
          <button
            className="topbar-search-btn"
            aria-pressed={view === 'search'}
            onClick={() => navigate(pathForView('search'))}
            aria-label="Search"
            title="Search"
          >
            <SearchIcon size="lg" />
            <span className="topbar-search-label">Search</span>
          </button>
          <div className="topbar-spacer" />
          <button
            type="button"
            className="topbar-huddle"
            disabled
            title="Huddles arrive in a later release"
          >
            <HuddleIcon size="md" />
            <span className="topbar-huddle-label">Huddle</span>
          </button>
          {isAdmin && (
            <button
              type="button"
              className="topbar-invite"
              onClick={() => navigate('/admin/invitations')}
              title="Invite people"
            >
              <MembersIcon size="md" />
              <span className="topbar-invite-label">Invite</span>
            </button>
          )}
        </>
      ) : (
        <>
          <div className="topbar-spacer" />
          <button
            className="btn btn-ghost topbar-feedback"
            onClick={onFeedback}
            title="Report a bug or send feedback"
          >
            <FeedbackIcon size="md" />
            <span className="topbar-feedback-label">Feedback</span>
          </button>
        </>
      )}

      <AccountMenu onFeedback={onFeedback} />
    </header>
  );
}

function AccountMenu({ onFeedback }: { onFeedback: () => void }) {
  const currentUser = useStore((s) => s.currentUser);
  const status = useStore((s) => s.status);
  const path = usePath();
  const [open, setOpen] = useState(false);

  // Navigating away should not leave the menu hanging open behind the new screen.
  // Adjusted during render rather than in an effect, which avoids the extra pass.
  const [menuPath, setMenuPath] = useState(path);
  if (menuPath !== path) {
    setMenuPath(path);
    setOpen(false);
  }

  // Read once and cleared on arrival, in the same render-phase adjustment: the page
  // marks itself read in an effect, so re-reading storage here would race it.
  const [unseenRelease, setUnseenRelease] = useState(hasUnseenRelease);
  if (unseenRelease && path === '/whats-new') setUnseenRelease(false);

  if (!currentUser) return null;

  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'owner';
  const isOwner = currentUser.role === 'owner';
  const visible = ITEMS.filter(
    (item) => (!item.adminOnly || isAdmin) && (!item.ownerOnly || isOwner),
  );

  return (
    <div className="user-menu">
      <button
        className="user-menu-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          // The panel's capture-phase outside-click dismissal runs before this
          // handler, so a click here while open has already closed the menu —
          // only opening is left to do. A plain toggle would reopen it.
          if (!open) setOpen(true);
        }}
        title={currentUser.displayName}
      >
        <span className="user-menu-avatar">
          <Avatar user={currentUser} size="sm" />
          <span
            className="presence-dot"
            data-state={status === 'online' ? 'active' : 'offline'}
            title={status === 'online' ? 'Connected' : 'Reconnecting…'}
          />
        </span>
        <span className="user-menu-name">{currentUser.displayName}</span>
        {/* A quiet mark, not a count: there is nothing to act on, only something to
            read, and a red badge would make release notes feel like an unread DM. */}
        {unseenRelease && <span className="menu-dot" aria-hidden="true" />}
        <ChevronDownIcon size="sm" />
      </button>

      <Menu open={open} onClose={() => setOpen(false)} className="user-menu-panel">
        <div className="user-menu-header">
          <div className="user-menu-header-name">{currentUser.displayName}</div>
          <div className="user-menu-header-email">{currentUser.email}</div>
        </div>

        {visible.map((item) =>
          item.soon ? (
            <button
              key={item.label}
              className="user-menu-item"
              role="menuitem"
              disabled
              title="Not built yet"
            >
              {item.label}
              <span className="user-menu-soon">Soon</span>
            </button>
          ) : (
            <button
              key={item.label}
              className="user-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                // The snapshot must be of the page behind the menu, so the menu
                // closes before the dialog opens and the capture runs.
                if (item.action === 'feedback') onFeedback();
                else navigate(item.path as string);
              }}
            >
              {item.label}
              {item.path === '/whats-new' && unseenRelease && (
                <span className="menu-dot" aria-label="New since you last looked" />
              )}
            </button>
          ),
        )}
      </Menu>
    </div>
  );
}
