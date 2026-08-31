/** The chrome the two consoles share.
 *
 * The instance console and the workspace console are two rooms of one product, with the
 * same markup deliberately, and this component is that sameness made structural: the
 * console grid, the nav, the mobile drawer with its scrim and toggle, the page heading,
 * the error slot. The class names are a contract with app.css — `.admin-shell` is the
 * grid, and below 900px the drawer works off `data-nav` plus `.admin-nav-scrim` and
 * `.admin-nav-toggle` — so they must not change here without changing the stylesheet.
 *
 * What differs between the consoles arrives as props. What a console gates for its body
 * — roles, sign-out — stays in the console.
 */

import { useState, type ReactNode } from 'react';
import { TopBar } from '../shell/TopBar.tsx';
import { AdminNav } from './AdminNav.tsx';
import type { NavGroup } from './registry.ts';

/** What the nav shows: the consoles differ in catalogue and framing, not in the mount. */
export interface ConsoleNav {
  groups: NavGroup[];
  /** `/admin` or `/workspace` — the prefix the nav's rows navigate under. */
  basePath: string;
  title: string;
  subtitle: string;
  /** Only the workspace console passes this: it carries personal sections for plain members. */
  isAdmin?: boolean;
}

export function ConsoleShell({
  view,
  navId,
  nav,
  section,
  isOwner,
  title,
  description,
  toggle,
  resetKey,
  onFeedback,
  children,
}: {
  /** Which console this is, for the top bar's pressed state. */
  view: 'admin' | 'workspace';
  /** Ties the drawer toggle to the nav it opens, for anything reading the page structure. */
  navId: string;
  nav: ConsoleNav;
  section: string;
  isOwner: boolean;
  title: string;
  description?: string;
  /** The consoles' toggle buttons differ in class, label and icon weight; each brings its own. */
  toggle: { className: string; label: string; icon: ReactNode };
  /**
   * Scopes an error to the page that produced it: when this changes, the error clears.
   * Omitted, errors survive navigation between sections.
   */
  resetKey?: string;
  onFeedback: () => void;
  /** The body needs somewhere to put its errors, so children take the setter. */
  children: (onError: (message: string | null) => void) => ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  // Clearing during render rather than in an effect avoids showing the previous page's
  // failure for one frame — including when the Back button is what moved you.
  const [shownFor, setShownFor] = useState(resetKey);
  if (shownFor !== resetKey) {
    setShownFor(resetKey);
    setError(null);
  }

  return (
    <div className="admin-shell" data-nav={navOpen ? 'open' : 'closed'}>
      <TopBar onFeedback={onFeedback} view={view} />
      <AdminNav
        id={navId}
        groups={nav.groups}
        section={section}
        isOwner={isOwner}
        isAdmin={nav.isAdmin}
        onNavigate={() => setNavOpen(false)}
        basePath={nav.basePath}
        title={nav.title}
        subtitle={nav.subtitle}
      />
      <button
        className="admin-nav-scrim"
        aria-label="Close the section menu"
        onClick={() => setNavOpen(false)}
      />

      <main className="admin-main">
        <div className="admin-page">
          <header className="admin-page-header">
            <button
              className={toggle.className}
              aria-label={toggle.label}
              aria-expanded={navOpen}
              aria-controls={navId}
              onClick={() => setNavOpen(true)}
            >
              {toggle.icon}
            </button>
            <div>
              <h1 className="page-title">{title}</h1>
              {description && <p className="page-sub">{description}</p>}
            </div>
          </header>

          {error && (
            <p className="error-text" style={{ marginTop: 16 }}>
              {error}
            </p>
          )}

          <div className="admin-page-body">{children(setError)}</div>
        </div>
      </main>
    </div>
  );
}
