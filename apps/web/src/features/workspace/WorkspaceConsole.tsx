/** Setting up the workspace.
 *
 * Its own page rather than a section of the server console, because the two answer
 * different questions for different people. This one is "what is this workspace like" —
 * its name, how it looks, how people get in. The superadmin console is "is the server
 * behaving" — health, the audit trail, installed apps, the people table.
 *
 * They were one screen, and workspace setup had shrunk to a single name field three
 * clicks inside an operational console, which is the wrong end of the product to hide
 * the first thing an owner wants to change.
 *
 * The shell markup mirrors the admin console deliberately: same classes, same shape, so
 * the two feel like one product with two rooms rather than two apps.
 */

import { useCallback, useState } from 'react';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { navigate, WORKSPACE_SECTIONS, type WorkspaceSection } from '../../lib/router.ts';
import { TopBar } from '../shell/TopBar.tsx';
import { useAdminAction, useAdminData } from '../admin/hooks.ts';
import { ThemesSection } from '../admin/sections/ThemesSection.tsx';

const SECTIONS: Record<WorkspaceSection, { label: string; description: string }> = {
  general: {
    label: 'General',
    description: 'What this workspace is called, and what people see first.',
  },
  appearance: {
    label: 'Appearance',
    description: 'The colours everyone here sees.',
  },
};

export function WorkspaceConsole({
  section,
  onFeedback,
}: {
  section: WorkspaceSection;
  onFeedback: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const entry = SECTIONS[section];

  return (
    <div className="admin-shell" data-nav="closed">
      <TopBar onFeedback={onFeedback} />

      <nav className="admin-nav" aria-label="Workspace settings">
        <div className="admin-nav-header">
          <button className="admin-back" onClick={() => navigate('/')}>
            ← Back to Blob
          </button>
          <div className="admin-nav-title">Workspace</div>
          <div className="admin-nav-sub">How this workspace works</div>
        </div>

        <div className="sidebar-scroll">
          <section className="sidebar-section">
            <h2 className="section-label">Settings</h2>
            {WORKSPACE_SECTIONS.map((id) => (
              <button
                key={id}
                className="channel-row"
                aria-current={id === section ? 'page' : undefined}
                onClick={() => navigate(`/workspace/${id}`)}
              >
                <span className="channel-name">{SECTIONS[id].label}</span>
              </button>
            ))}
          </section>

          <section className="sidebar-section">
            <h2 className="section-label">Elsewhere</h2>
            <button className="channel-row" onClick={() => navigate('/admin')}>
              <span className="channel-name">Superadmin</span>
            </button>
          </section>
        </div>
      </nav>

      <main className="admin-main">
        <div className="admin-page">
          <header className="admin-page-header">
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
            {section === 'general' && <GeneralSection onError={setError} />}
            {section === 'appearance' && <ThemesSection onError={setError} />}
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
