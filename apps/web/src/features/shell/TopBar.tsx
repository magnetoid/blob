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
import { ChevronDownIcon } from '../../components/Icon.tsx';

interface Item {
  label: string;
  path?: string;
  action?: 'feedback';
  /** Shown but inert, with a reason, rather than hidden. */
  soon?: boolean;
  adminOnly?: boolean;
}

const ITEMS: Item[] = [
  { label: 'Superadmin', path: '/admin', adminOnly: true },
  { label: 'User profile', path: '/profile' },
  { label: 'Settings', path: '/settings' },
  { label: 'Update', soon: true },
  { label: 'Feedback', action: 'feedback' },
];

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

  if (!currentUser) return null;

  const visible = ITEMS.filter((item) => !item.adminOnly || isAdmin);

  return (
    <header className="topbar">
      <div className="topbar-brand">{workspaceName}</div>
      <div className="topbar-spacer" />

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
                </button>
              ),
            )}
          </div>
        )}
      </div>
    </header>
  );
}
