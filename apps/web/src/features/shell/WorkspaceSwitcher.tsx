/** Moving between the workspaces you belong to.
 *
 * Hung off the workspace name in the corner, which is where Slack puts it and therefore
 * where people already look. It stays a plain label until there is somewhere to go: a
 * server with one workspace should not grow a menu whose only entry is the page you are
 * already on.
 *
 * Switching reloads the page rather than re-fetching into the live store. The session
 * cookie now points at a different account, so every channel id, message, member and
 * unread cursor held in memory belongs to a workspace this browser is no longer in —
 * and a store built for one workspace has nowhere to put two. A reload is one line and
 * cannot leave a stale row behind; reconciling would be neither.
 */

import { useEffect, useRef, useState } from 'react';
import { api, type WorkspaceMembership } from '../../lib/api.ts';
import { ChevronDownIcon } from '../../components/Icon.tsx';

export function WorkspaceSwitcher({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceMembership[] | null>(null);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fetched once, on mount: it decides whether this is a button at all, and asking on
  // every open would flash a menu that changes shape as it loads.
  useEffect(() => {
    let live = true;
    void api.workspaces
      .mine()
      .then((result) => {
        if (live) setWorkspaces(result.workspaces);
      })
      .catch(() => {
        // A switcher that cannot list is a switcher that stays a label. Nothing here is
        // worth an error banner over.
        if (live) setWorkspaces([]);
      });
    return () => {
      live = false;
    };
  }, []);

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

  if (!workspaces || workspaces.length < 2) {
    return <div className="topbar-brand">{name}</div>;
  }

  return (
    <div className="workspace-switcher" ref={menuRef}>
      <button
        className="topbar-brand workspace-switcher-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        {name}
        <ChevronDownIcon size="sm" />
      </button>

      {open && (
        <div className="user-menu-panel" role="menu">
          <div className="user-menu-header">
            <div className="user-menu-header-email">Your workspaces</div>
          </div>
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              className="user-menu-item"
              role="menuitem"
              disabled={workspace.current || busy}
              onClick={() => {
                setBusy(true);
                void api.workspaces
                  .switch(workspace.id)
                  .then(() => {
                    // Everything in memory belongs to the workspace we just left.
                    window.location.assign('/');
                  })
                  .catch(() => setBusy(false));
              }}
            >
              {workspace.name}
              {workspace.current && <span className="user-menu-soon">Current</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
