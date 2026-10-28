/** The console's own sidebar.
 *
 * Rows rather than a strip of pills, because the console has outgrown a strip. The rows
 * are the same primitive as the channel list, so the reflexes carry over — including that
 * the current one is marked, not merely coloured.
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

import { useState } from 'react';
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

export function ConsoleNav({
  id,
  groups,
  section,
  viewer,
  onNavigate,
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
  /** Lets the mobile drawer close itself once a choice has been made. */
  onNavigate?: () => void;
  basePath?: string;
  baseAccess?: Access;
  title?: string;
  subtitle?: string;
}) {
  const [filter, setFilter] = useState('');
  const visible = filterGroups(groups, filter, viewer);

  const row = (entry: SectionEntry) => {
    const restricted =
      entry.access && RANK[entry.access] > RANK[baseAccess] ? RESTRICTED[entry.access] : null;
    return (
      <button
        key={entry.id}
        className="channel-row"
        aria-current={entry.id === section}
        type="button"
        onClick={() => {
          onNavigate?.();
          navigate(`${basePath}/${entry.id}`);
        }}
      >
        <span className="channel-name">{entry.label}</span>
        {restricted && (
          <span className="console-nav-badge" data-kind={entry.access} title={restricted.title}>
            {restricted.label}
          </span>
        )}
        {entry.badge === 'new' && (
          <span className="console-nav-badge" data-kind="new">
            New
          </span>
        )}
      </button>
    );
  };

  return (
    <nav id={id} className="admin-nav" aria-label="Console sections">
      <div className="admin-nav-header">
        <button className="admin-back" onClick={() => navigate('/')}>
          <ChevronLeftIcon size="sm" />
          Back to workspace
        </button>
        <div className="admin-nav-title">{title}</div>
        <div className="admin-nav-sub">
          {subtitle ??
            (viewer.role === 'owner'
              ? 'You own this workspace.'
              : 'You are an admin. Only the owner can change roles.')}
        </div>
      </div>

      {/* The same border, corner and focus colour as the inputs on the page it filters,
          at a height that suits a nav. It borrowed the search view's field, which is
          taller and darker-edged than anything else here. */}
      <div className="console-nav-filter">
        <div className="console-filter">
          <SearchIcon size="sm" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a setting"
            aria-label="Filter sections"
          />
        </div>
      </div>

      <div className="sidebar-scroll">
        {visible.map((group) =>
          group.label ? (
            <section className="sidebar-section" key={group.id}>
              <h2 className="section-label">{group.label}</h2>
              {group.sections.map(row)}
            </section>
          ) : (
            // No heading, so no `section`: one with nothing naming it is noise to a screen
            // reader, and the nav around it already says what these rows are.
            <div className="sidebar-section" key={group.id}>
              {group.sections.map(row)}
            </div>
          ),
        )}

        {visible.length === 0 && <p className="muted console-nav-empty">Nothing matched.</p>}
      </div>
    </nav>
  );
}
