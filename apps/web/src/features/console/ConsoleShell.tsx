/** The chrome the three consoles share.
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
import { ConsoleNav } from './ConsoleNav.tsx';
import type { Access, NavGroup, Viewer } from './registry.ts';

export interface ConsoleSectionProps {
  onError: (message: string | null) => void;
  isOwner: boolean;
  /**
   * Whether this person administers the server, not only this workspace. People reads it
   * to draw Accounts, the part of that page the server keeps for its admin — the same
   * gate as the `users` row in the registry. Optional: no other section asks yet.
   */
  isInstanceAdmin?: boolean;
  detailId?: string;
  /**
   * Only the Preferences section uses this — it owns the Sign out button, which is the
   * one control on these pages that ends the session rather than changing a setting.
   */
  onSignedOut?: () => void;
}

/** What the nav shows: the consoles differ in catalogue and framing, not in the mount. */
export interface ConsoleNav {
  groups: NavGroup[];
  /** `/admin`, `/server` or `/settings` — the prefix the nav's rows navigate under. */
  basePath: string;
  /**
   * The level everybody who can open this console passes. A row at that level carries
   * no badge; one the console keeps from some of its visitors names who may open it.
   */
  baseAccess?: Access;
  title: string;
  subtitle: string;
}

export function ConsoleShell({
  view,
  navId,
  nav,
  section,
  viewer,
  title,
  description,
  toggle,
  resetKey,
  onFeedback,
  children,
}: {
  /** Which console this is, for the top bar's pressed state. */
  view: 'admin' | 'settings' | 'server';
  /** Ties the drawer toggle to the nav it opens, for anything reading the page structure. */
  navId: string;
  nav: ConsoleNav;
  section: string;
  /** Who is looking. The nav offers each row by it; the body is gated by the console. */
  viewer: Viewer;
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
      <ConsoleNav
        id={navId}
        groups={nav.groups}
        section={section}
        viewer={viewer}
        onNavigate={() => setNavOpen(false)}
        basePath={nav.basePath}
        baseAccess={nav.baseAccess}
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

          {error && <p className="error-text console-error">{error}</p>}

          {/* Keyed by the section, so arriving at a page plays its entrance once — and a
              detail id changing inside one (Apps → one app) does not replay it. */}
          <div className="admin-page-body" key={section}>
            {children(setError)}
          </div>
        </div>
      </main>
    </div>
  );
}
