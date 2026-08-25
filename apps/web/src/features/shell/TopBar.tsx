/**
 * The bar across the top, and the user menu at the right of it.
 *
 * Slack puts your avatar in the top-right corner and hangs the account menu off it, so
 * that is where this lives. The bar spans every column of the shell, which is what makes
 * the menu reachable from the conversation, search, preferences and administration
 * alike — a menu that only existed in one view would be a menu people could lose.
 */

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../lib/store.ts';
import { navigate, usePath } from '../../lib/router.ts';
import { Avatar } from '../../components/Avatar.tsx';
import { WorkspaceSwitcher } from './WorkspaceSwitcher.tsx';
import { ChevronDownIcon, FeedbackIcon } from '../../components/Icon.tsx';
import { ITEMS } from './menu.ts';
import { hasUnseenRelease } from '../../lib/changelog.ts';


export function TopBar({ onFeedback }: { onFeedback: () => void }) {
  const currentUser = useStore((s) => s.currentUser);
  const workspaceName = useStore((s) => s.workspaceName);
  const status = useStore((s) => s.status);
  const path = usePath();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'owner';

  // Close on any click outside and on Escape. Capture phase, so a click that lands on
  // another control dismisses this first rather than leaving two menus open.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

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
      <WorkspaceSwitcher name={workspaceName} />
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

      <div className="user-menu" ref={menuRef}>
        <button
          className="user-menu-trigger"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((value) => !value)}
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

        {open && (
          <div className="user-menu-panel" role="menu">
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
          </div>
        )}
      </div>
    </header>
  );
}
