/** What this server is called. */

import { useCallback, useState } from 'react';
import { api } from '../../../lib/api.ts';
import { useStore } from '../../../lib/store.ts';
import { useAdminAction, useAdminData } from '../../console/hooks.ts';

export function GeneralSection({ onError }: { onError: (message: string | null) => void }) {
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const settings = await api.admin.settings();
    setName(settings.name);
    return settings;
  }, []);

  const { reload } = useAdminData(load, [], onError, 'Could not load server settings.');
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
          <span className="field-label">Server name</span>
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
