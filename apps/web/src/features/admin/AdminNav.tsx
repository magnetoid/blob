/** The console's own sidebar.
 *
 * Grouped rows rather than a strip of pills, because the console has outgrown a strip:
 * grouping is what lets someone who has never opened this screen guess where retention
 * lives. The rows are the same primitive as the channel list, so the reflexes carry over
 * — including that the current one is marked, not merely coloured.
 *
 * The filter is here for the same reason Mattermost's is: past a dozen sections, reading
 * every label is slower than typing three characters of the one you want.
 */

import { useState } from 'react';
import { ChevronLeftIcon, SearchIcon } from '../../components/Icon.tsx';
import { navigate } from '../../lib/router.ts';
import { ADMIN_NAV, filterGroups, isPlanned, type NavGroup } from './registry.ts';

export function AdminNav({
  id,
  groups = ADMIN_NAV,
  section,
  isOwner,
  isAdmin = true,
  onNavigate,
  /** `/admin` or `/workspace`. Both consoles use this nav; only the prefix differs. */
  basePath = '/admin',
  title = 'Administration',
  subtitle,
}: {
  id?: string;
  groups?: NavGroup[];
  section: string;
  isOwner: boolean;
  /** False hides every admin-only group — this page also carries personal sections. */
  isAdmin?: boolean;
  /** Lets the mobile drawer close itself once a choice has been made. */
  onNavigate?: () => void;
  basePath?: string;
  title?: string;
  subtitle?: string;
}) {
  const [filter, setFilter] = useState('');
  const visible = filterGroups(groups, filter, isOwner, isAdmin);

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
            (isOwner
              ? 'You own this workspace.'
              : 'You are an admin. Only the owner can change roles.')}
        </div>
      </div>

      <div className="sidebar-search">
        <div className="search-field">
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
        {visible.map((group) => (
          <section className="sidebar-section" key={group.id}>
            <h2 className="section-label">{group.label}</h2>
            {group.sections.map((entry) =>
              isPlanned(entry) ? (
                <button
                  key={entry.id}
                  className="channel-row"
                  disabled
                  title="Not built yet"
                  type="button"
                >
                  <span className="channel-name muted">{entry.label}</span>
                  <span className="user-menu-soon">Soon</span>
                </button>
              ) : (
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
                  {entry.badge === 'new' && <span className="role-pill">New</span>}
                </button>
              ),
            )}
          </section>
        ))}

        {visible.length === 0 && (
          <p className="muted" style={{ padding: '8px 10px' }}>
            Nothing matched.
          </p>
        )}
      </div>
    </nav>
  );
}
