/**
 * The bar across the top: workspace, view switching, and the user menu at the right.
 *
 * Slack puts your avatar in the top-right corner and hangs the account menu off it, so
 * that is where this lives. The bar spans every column of the shell, which is what makes
 * the menu reachable from the conversation, search, preferences and administration
 * alike — a menu that only existed in one view would be a menu people could lose.
 *
 * **Switching views is here too, and used to be a 64px column down the left.** That rail
 * held four buttons and a workspace initial, and it charged the full height of the window
 * for them — beside a 264px sidebar, a third of the screen went to navigation before any
 * conversation started. The buttons moved into the row that was already spanning the whole
 * width and already had empty middle. This is a departure from Slack's layout, and a
 * deliberate one: the icons keep their labels, their order and their shortcuts, so what
 * changes is where the eye finds them, not what they do.
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
}

export function TopBar({ onFeedback, onToggleSidebar, view }: Props) {
  const currentUser = useStore((s) => s.currentUser);
  const workspaceName = useStore((s) => s.workspaceName);
  const status = useStore((s) => s.status);
  const path = usePath();
  const [open, setOpen] = useState(false);

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'owner';

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

  const isOwner = currentUser?.role === 'owner';
  const visible = ITEMS.filter(
    (item) => (!item.adminOnly || isAdmin) && (!item.ownerOnly || isOwner),
  );

  return (
    <header className="topbar">
      {onToggleSidebar && (
        <button
          type="button"
          className="topbar-hamburger"
          aria-label="Channels"
          onClick={onToggleSidebar}
        >
          <MenuIcon size={18} strokeWidth={1.8} />
        </button>
      )}
      <WorkspaceSwitcher name={workspaceName} />

      {/* The bar does its own navigating. Every call site passed the identical callback,
          which was three chances to wire the same thing differently and no expressiveness
          in return. */}
      <nav className="topbar-nav" aria-label="Views">
        <button
          className="topbar-nav-btn"
          aria-pressed={view === 'messages' || view === 'channel'}
          onClick={() => navigate(pathForView('messages'))}
          title="Messages"
        >
          <MessagesIcon size={17} strokeWidth={1.7} />
          <span className="topbar-nav-label">Messages</span>
        </button>
        <button
          className="topbar-nav-btn"
          aria-pressed={view === 'search'}
          onClick={() => navigate(pathForView('search'))}
          title="Search"
        >
          <SearchIcon size={17} strokeWidth={1.7} />
          <span className="topbar-nav-label">Search</span>
        </button>
        {isAdmin && (
          <button
            className="topbar-nav-btn"
            aria-pressed={view === 'admin'}
            onClick={() => navigate(pathForView('admin'))}
            title="Administration"
          >
            <MembersIcon size={17} strokeWidth={1.7} />
            <span className="topbar-nav-label">Admin</span>
          </button>
        )}
        <button
          className="topbar-nav-btn"
          aria-pressed={view === 'workspace'}
          onClick={() => navigate(pathForRoute({ view: 'workspace', section: 'preferences' }))}
          title="Preferences"
        >
          <SettingsIcon size={17} strokeWidth={1.7} />
          <span className="topbar-nav-label">Preferences</span>
        </button>
      </nav>

      <div className="topbar-spacer" />

      {/* Its own control, in the corner, rather than the last row of the account menu
          under a disabled "Update — Soon". Everything a ticket is worth — the console
          log, the page as it stood, the URL and the viewport — is captured the moment
          this opens, so a report costs a click at the moment the thing went wrong.
          Buried one menu deep, that moment passes. The menu row stays: this adds a way
          in, the way Administration did in the sidebar, it does not move the old one. */}
      <button
        className="btn btn-ghost topbar-feedback"
        onClick={onFeedback}
        title="Report a bug or send feedback"
      >
        <FeedbackIcon size={15} />
        <span className="topbar-feedback-label">Feedback</span>
      </button>

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
          <ChevronDownIcon size={13} strokeWidth={2} />
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
    </header>
  );
}
