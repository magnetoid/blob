/**
 * The workspace switcher's menu, as a module the top bar fetches beside the overlay chunk
 * (`components/lazyDropdown.tsx`). Only drawn when there are two or more workspaces to
 * choose between; `WorkspaceSwitcher.tsx` decides that and draws the trigger.
 *
 * Switching reloads the page rather than re-fetching into the live store: the session
 * cookie now points at a different account, so everything held in memory belongs to a
 * workspace this browser has left.
 *
 * Controlled, so that its place on the Escape stack (`lib/useMenuEscapeLayer.ts`) can close
 * it: while it is open an Escape is the menu's, not the panel's behind it.
 */

import { useState } from 'react';
import { api, type WorkspaceMembership } from '../../lib/api.ts';
import { useMenuEscapeLayer } from '../../lib/useMenuEscapeLayer.ts';
import type { DropdownModuleProps } from '../../components/lazyDropdown.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';

interface Props extends DropdownModuleProps {
  workspaces: WorkspaceMembership[];
}

export default function WorkspaceMenu({ trigger, defaultOpen, workspaces }: Props) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(defaultOpen ?? false);
  const { popupRef, triggerRef } = useMenuEscapeLayer(open, setOpen);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger ref={triggerRef} render={trigger} />
      <DropdownMenuContent
        ref={popupRef}
        align="start"
        sideOffset={6}
        className="w-auto min-w-52"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>Your workspaces</DropdownMenuLabel>
          {workspaces.map((workspace) => (
            <DropdownMenuItem
              key={workspace.id}
              className="pointer-coarse:min-h-11"
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
              {workspace.current && (
                <Badge variant="secondary" className="ml-auto">
                  Current
                </Badge>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
