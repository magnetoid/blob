/** The console's own sidebar.
 *
 * Rows rather than a strip of pills, because the console has outgrown a strip — the
 * channel list's reflexes, including that the current row is marked, not merely coloured.
 * It is shadcn's sidebar menu, inside the frame's `Sidebar`: a column from 768px, a sheet
 * below it, which a choice closes.
 *
 * Settings is one group under its heading and the workspace console is three; the
 * server console is one list under none. A group without a label is drawn without a
 * heading. A row the console keeps from some of its visitors carries a badge naming who
 * may open it — measured against the level everybody there passes, so the server
 * console does not badge every one of its rows "Server".
 *
 * The filter is here for the same reason Mattermost's is: past a dozen sections, reading
 * every label is slower than typing three characters of the one you want.
 */

import { useId, useState } from 'react';
import { Button } from '../../components/ui/button.tsx';
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '../../components/ui/sidebar.tsx';
import { ChevronLeftIcon, SearchIcon } from '../../components/Icon.tsx';
import { navigate } from '../../lib/router.ts';
import {
  filterGroups,
  type Access,
  type NavGroup,
  type SectionEntry,
  type Viewer,
} from './registry.ts';

/**
 * What a restricted row's badge says. On the row because only the people who can see it
 * see it, and they have no other way to tell which pages their admins cannot reach — so
 * it names who can, in the words the rest of the app uses for them.
 */
const RESTRICTED: Record<Access, { label: string; title: string } | null> = {
  admin: null,
  owner: { label: 'Owner', title: "Only this workspace's owner can open this." },
  instance: { label: 'Server', title: "Only the server's admin can open this." },
};

/** Each level opens everything below it, so a badge is for a row above the console's own. */
const RANK: Record<Access, number> = { admin: 0, owner: 1, instance: 2 };

/**
 * One badge in three kinds, the same size and type so they line up at the rows' end:
 * outlined for a row only the owner or only the server's admin may open, the accent for
 * new. Positioned by the strip they sit in, so a row may carry two side by side.
 */
const BADGE = 'static h-[18px] translate-y-0 rounded-full border px-2 text-[11px] font-semibold';
const BADGE_KIND = {
  restricted: 'border-sidebar-border text-muted-foreground',
  new: 'border-ring bg-sidebar-accent text-primary',
};

/**
 * Where you are is marked twice: the wash the channel list uses, and a bar at the row's
 * edge, so it does not rest on a tint that a custom theme may have made faint.
 */
const CURRENT_BAR =
  'data-active:before:absolute data-active:before:inset-y-[7px] data-active:before:left-0 data-active:before:w-[3px] data-active:before:rounded-full data-active:before:bg-primary';

export function ConsoleNav({
  id,
  groups,
  section,
  viewer,
  /** `/admin`, `/server` or `/settings`. Every console uses this nav; only the prefix differs. */
  basePath = '/admin',
  /** The level everybody who can open this console passes; rows at it carry no badge. */
  baseAccess = 'admin',
  title = 'Administration',
  subtitle,
}: {
  id?: string;
  groups: NavGroup[];
  section: string;
  /** Who is looking: decides which rows are offered at all, against each row's `access`. */
  viewer: Viewer;
  basePath?: string;
  baseAccess?: Access;
  title?: string;
  subtitle?: string;
}) {
  const [filter, setFilter] = useState('');
  const visible = filterGroups(groups, filter, viewer);
  // Below 768px the nav is a sheet, and choosing a page is what it was opened for.
  const { setOpenMobile } = useSidebar();
  const badgeIds = useId();

  const row = (entry: SectionEntry) => {
    const restricted =
      entry.access && RANK[entry.access] > RANK[baseAccess] ? RESTRICTED[entry.access] : null;
    const badges: { kind: string; label: string; tone: string }[] = [];
    if (entry.access && restricted) {
      badges.push({ kind: entry.access, label: restricted.label, tone: BADGE_KIND.restricted });
    }
    if (entry.badge === 'new') badges.push({ kind: 'new', label: 'New', tone: BADGE_KIND.new });
    const idOf = (kind: string) => `${badgeIds}-${entry.id}-${kind}`;

    return (
      <SidebarMenuItem key={entry.id}>
        <SidebarMenuButton
          isActive={entry.id === section}
          aria-current={entry.id === section}
          // The badge is beside the button, not in it, so the row's name stays its label;
          // it describes the button, so a screen reader hears it with the row.
          aria-describedby={
            badges.length > 0 ? badges.map((badge) => idOf(badge.kind)).join(' ') : undefined
          }
          title={restricted?.title}
          className={badges.length > 0 ? `${CURRENT_BAR} pr-16` : CURRENT_BAR}
          onClick={() => {
            setOpenMobile(false);
            navigate(`${basePath}/${entry.id}`);
          }}
        >
          <span>{entry.label}</span>
        </SidebarMenuButton>
        {badges.length > 0 && (
          <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center gap-1">
            {badges.map((badge) => (
              <SidebarMenuBadge
                key={badge.kind}
                id={idOf(badge.kind)}
                data-kind={badge.kind}
                className={`${BADGE} ${badge.tone}`}
              >
                {badge.label}
              </SidebarMenuBadge>
            ))}
          </div>
        )}
      </SidebarMenuItem>
    );
  };

  return (
    <nav id={id} aria-label="Console sections" className="flex min-h-0 flex-1 flex-col">
      <SidebarHeader className="gap-3 px-3 pt-3 pb-1">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-1 self-start text-muted-foreground"
          onClick={() => navigate('/')}
        >
          <ChevronLeftIcon size="sm" />
          Back to workspace
        </Button>
        <div className="px-1">
          <p className="font-heading text-base font-semibold tracking-tight">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {subtitle ??
              (viewer.role === 'owner'
                ? 'You own this workspace.'
                : 'You are an admin. Only the owner can change roles.')}
          </p>
        </div>
        <div className="relative">
          <SearchIcon
            size="sm"
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
          />
          <SidebarInput
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a setting"
            aria-label="Filter sections"
            className="pl-8"
          />
        </div>
      </SidebarHeader>

      <SidebarContent className="pb-4">
        {visible.map((group) => (
          // A heading only where the group has a label: an unnamed group is noise to a
          // screen reader, and the nav around it already says what these rows are.
          <SidebarGroup key={group.id}>
            {group.label && (
              // The label is the heading's content; `render` only names the element.
              // eslint-disable-next-line jsx-a11y/heading-has-content
              <SidebarGroupLabel render={<h2 />} className="text-muted-foreground">
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarMenu>{group.sections.map(row)}</SidebarMenu>
          </SidebarGroup>
        ))}

        {visible.length === 0 && (
          <p className="px-4 py-2 text-sm text-muted-foreground">Nothing matched.</p>
        )}
      </SidebarContent>
    </nav>
  );
}
