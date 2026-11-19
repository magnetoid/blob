/** Moving between the workspaces you belong to.
 *
 * Hung off the workspace name in the corner, which is where Slack puts it and therefore
 * where people already look. It stays a plain label until there is somewhere to go: a
 * server with one workspace should not grow a menu whose only entry is the page you are
 * already on. The menu is `WorkspaceMenu.tsx`, fetched beside the overlay chunk; this
 * file draws only the name and the button, which are first-load code.
 */

import { useEffect, useState } from 'react';
import { api, type WorkspaceMembership } from '../../lib/api.ts';
import { lazyDropdown } from '../../components/lazyDropdown.tsx';
import { Button } from '../../components/ui/button.tsx';
import { ChevronDownIcon } from '../../components/Icon.tsx';

const WorkspaceMenuLazy = lazyDropdown(() => import('./WorkspaceMenu.tsx'));

export function WorkspaceSwitcher({ name }: { name: string }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceMembership[] | null>(null);

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

  // On a phone the bar has room for the mark or the name beside the search, not both: the
  // name goes to the screen reader and the chevron stays, so it still opens.
  if (!workspaces || workspaces.length < 2) {
    return <div className="min-w-0 truncate text-base font-bold max-sm:sr-only">{name}</div>;
  }

  return (
    <WorkspaceMenuLazy
      workspaces={workspaces}
      trigger={
        <Button variant="ghost" className="min-w-0 gap-1.5 px-1.5 text-base font-bold">
          <span className="truncate max-sm:sr-only">{name}</span>
          <ChevronDownIcon size="sm" className="text-muted-foreground" />
        </Button>
      }
    />
  );
}
