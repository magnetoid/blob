/** Running one workspace.
 *
 * This is where an owner or admin actually works: who is in the workspace, who has been
 * invited, what channels exist, which apps and agents are installed, what webhooks point
 * at it, and how it looks. All of it used to be split across two consoles, with most of
 * it filed under "superadmin" — so inviting a colleague meant opening a screen named
 * after the server.
 *
 * The instance console is the other half, and it keeps only what is genuinely about the
 * machine: every account on it, every workspace on it, and whether it is healthy.
 *
 * Same nav component and the same markup as that console deliberately: two rooms of one
 * product, not two apps.
 */

import { useCallback, useState, type ComponentType } from 'react';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { MenuIcon } from '../../components/Icon.tsx';
import type { WorkspaceSection } from '../../lib/router.ts';
import { TopBar } from '../shell/TopBar.tsx';
import { AdminNav } from '../admin/AdminNav.tsx';
import { WORKSPACE_NAV, workspaceEntry } from '../admin/registry.ts';
import { useAdminAction, useAdminData } from '../admin/hooks.ts';
import type { AdminSectionProps } from '../admin/AdminConsole.tsx';
import { AppsSection } from '../admin/sections/AppsSection.tsx';
import { ChannelsSection } from '../admin/sections/ChannelsSection.tsx';
import { EmojiSection } from '../admin/sections/EmojiSection.tsx';
import { GroupsSection } from '../admin/sections/GroupsSection.tsx';
import { InvitationsSection } from '../admin/sections/InvitationsSection.tsx';
import { PeopleSection } from '../admin/sections/PeopleSection.tsx';
import { ThemesSection } from '../admin/sections/ThemesSection.tsx';
import { WebhooksSection } from '../admin/sections/WebhooksSection.tsx';
import { PreferencesSection } from '../../features/settings/PreferencesSection.tsx';
import { NotificationsSection } from '../../features/settings/NotificationsSection.tsx';

/** Ties the drawer toggle to the nav it opens, for anything reading the page structure. */
const NAV_ID = 'workspace-console-nav';

/**
 * Every route needs a screen. Typed as a total record, so adding a section to
 * WORKSPACE_SECTIONS without building it is a typecheck failure rather than a blank page.
 */
const SECTION_COMPONENTS: Record<WorkspaceSection, ComponentType<AdminSectionProps>> = {
  preferences: PreferencesSection,
  notifications: NotificationsSection,
  general: GeneralSection,
  members: PeopleSection,
  groups: GroupsSection,
  invitations: InvitationsSection,
  channels: ChannelsSection,
  apps: AppsSection,
  webhooks: WebhooksSection,
  appearance: ThemesSection,
  emoji: EmojiSection,
};

export function WorkspaceConsole({
  section,
  detailId,
  onFeedback,
  onSignedOut,
}: {
  section: WorkspaceSection;
  detailId?: string;
  onFeedback: () => void;
  onSignedOut: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const currentUser = useStore((s) => s.currentUser);
  const workspaceName = useStore((s) => s.workspaceName);
  const isOwner = currentUser?.role === 'owner';
  // A member reaches this page for their own preferences and sees only those. The
  // routing guard in `Workspace` keeps them off the admin sections; this keeps the nav
  // from advertising them.
  const isAdmin = isOwner || currentUser?.role === 'admin';
  const entry = workspaceEntry(section);
  const Body = SECTION_COMPONENTS[section];

  return (
    <div className="admin-shell" data-nav={navOpen ? 'open' : 'closed'}>
      <TopBar onFeedback={onFeedback} view="workspace" />
      <AdminNav
        id={NAV_ID}
        groups={WORKSPACE_NAV}
        section={section}
        isOwner={isOwner}
        isAdmin={isAdmin}
        onNavigate={() => setNavOpen(false)}
        basePath="/workspace"
        title="Workspace"
        subtitle={
          isOwner
            ? 'You own this workspace.'
            : isAdmin
              ? 'You are an admin of this workspace.'
              : `Your settings in ${workspaceName}.`
        }
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
              className="admin-nav-toggle"
              aria-label="Open the section menu"
              aria-controls={NAV_ID}
              aria-expanded={navOpen}
              onClick={() => setNavOpen(true)}
            >
              <MenuIcon size={16} strokeWidth={2} />
            </button>
            <div>
              <h1 className="admin-page-title">{entry.label}</h1>
              <p className="admin-page-sub">{entry.description}</p>
            </div>
          </header>

          {error && (
            <p className="error-text" style={{ marginTop: 16 }}>
              {error}
            </p>
          )}

          <div className="admin-page-body">
            <Body
              onError={setError}
              isOwner={isOwner}
              detailId={detailId}
              onSignedOut={onSignedOut}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

function GeneralSection({ onError }: { onError: (message: string | null) => void }) {
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const settings = await api.admin.settings();
    setName(settings.name);
    return settings;
  }, []);

  const { reload } = useAdminData(load, [], onError, 'Could not load the workspace.');
  const act = useAdminAction(onError, reload);

  return (
    <section style={{ maxWidth: 520 }}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void act(async () => {
            const updated = await api.admin.updateSettings({ name: name.trim() });
            // The name is in the top bar, so the store has to hear about it or the page
            // keeps showing the old one until a reload.
            useStore.setState({ workspaceName: updated.name });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          });
        }}
      >
        <label className="field">
          <span className="field-label">Workspace name</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Acme"
          />
          <span className="pref-hint">
            Shown in the top bar, on the sign-in screen, and in invitations.
          </span>
        </label>
        <button className="btn btn-primary" type="submit" style={{ marginTop: 14 }}>
          {saved ? 'Saved' : 'Save'}
        </button>
      </form>
    </section>
  );
}
