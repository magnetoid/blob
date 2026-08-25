/** The instance console: this server, across every workspace on it.
 *
 * A page of its own rather than a third column in the chat shell. The old layout put a
 * channel list beside the audit log, which was 264px of the screen spent on something
 * nobody administering a workspace is looking for, and gave every section the same
 * unlabelled heading. Here the nav says where you are and the heading says what you are
 * looking at.
 *
 * Members, invitations, channels, apps and webhooks used to live here. Every one of them
 * is a question about a single workspace, so every one of them moved to /workspace —
 * an owner should not have to open something called "superadmin" to invite a colleague.
 * What is left is what genuinely belongs to the machine: the accounts on it, the
 * workspaces on it, and whether it is healthy.
 *
 * The chat shell is not rendered at all while this is open — see Workspace.tsx. ⌘K still
 * works, because switching to a conversation is exactly what you want after finishing
 * with an admin page.
 */

import { useState, type ComponentType } from 'react';
import { MenuIcon } from '../../components/Icon.tsx';
import { useStore } from '../../lib/store.ts';
import type { AdminSection } from '../../lib/router.ts';
import { TopBar } from '../shell/TopBar.tsx';
import { AdminNav } from './AdminNav.tsx';
import { ADMIN_NAV, sectionEntry } from './registry.ts';
import { AppPolicySection } from './sections/AppPolicySection.tsx';
import { AccountsSection } from './sections/AccountsSection.tsx';
import { AuditSection } from './sections/AuditSection.tsx';
import { FeedbackSection } from './sections/FeedbackSection.tsx';
import { HealthSection } from './sections/HealthSection.tsx';
import { LogsSection } from './sections/LogsSection.tsx';
import { WorkspacesSection } from './sections/WorkspacesSection.tsx';

/** Ties the drawer toggle to the nav it opens, for anything reading the page structure. */
const NAV_ID = 'admin-console-nav';

export interface AdminSectionProps {
  onError: (message: string | null) => void;
  isOwner: boolean;
  detailId?: string;
  /**
   * Only the Preferences section uses this — it owns the Sign out button, which is the
   * one control on these pages that ends the session rather than changing a setting.
   */
  onSignedOut?: () => void;
}

/**
 * Every route needs a screen. Typed as a total record, so adding a section to
 * ADMIN_SECTIONS without building it is a typecheck failure rather than a blank page.
 */
const SECTION_COMPONENTS: Record<AdminSection, ComponentType<AdminSectionProps>> = {
  users: AccountsSection,
  'app-policy': AppPolicySection,
  workspaces: WorkspacesSection,
  feedback: FeedbackSection,
  audit: AuditSection,
  logs: LogsSection,
  health: HealthSection,
};

export function AdminConsole({
  section,
  detailId,
  onFeedback,
}: {
  section: AdminSection;
  detailId?: string;
  onFeedback: () => void;
}) {
  const currentUser = useStore((s) => s.currentUser);
  const isOwner = currentUser?.role === 'owner';

  const [error, setError] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  // An error belongs to the page that produced it. Clearing during render rather than in
  // an effect avoids showing the previous page's failure for one frame — including when
  // the Back button is what moved you.
  const [shownFor, setShownFor] = useState(`${section}/${detailId ?? ''}`);
  const key = `${section}/${detailId ?? ''}`;
  if (shownFor !== key) {
    setShownFor(key);
    setError(null);
  }

  const entry = sectionEntry(section);
  const Body = SECTION_COMPONENTS[section];

  return (
    <div className="admin-shell" data-nav={navOpen ? 'open' : 'closed'}>
      <TopBar onFeedback={onFeedback} />
      <AdminNav
        id={NAV_ID}
        groups={ADMIN_NAV}
        section={section}
        isOwner={isOwner}
        onNavigate={() => setNavOpen(false)}
        basePath="/admin"
        title="This server"
        subtitle="Every workspace on this instance."
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
              className="icon-btn admin-nav-toggle"
              aria-label="Console sections"
              aria-expanded={navOpen}
              aria-controls={NAV_ID}
              onClick={() => setNavOpen(true)}
            >
              <MenuIcon size={18} />
            </button>
            <div>
              <h1 className="admin-page-title">{entry.label}</h1>
              {entry.description && <p className="admin-page-sub">{entry.description}</p>}
            </div>
          </header>

          {error && (
            <p className="error-text" style={{ marginTop: 16 }}>
              {error}
            </p>
          )}

          <div className="admin-page-body">
            <Body onError={setError} isOwner={isOwner} detailId={detailId} />
          </div>
        </div>
      </main>
    </div>
  );
}
