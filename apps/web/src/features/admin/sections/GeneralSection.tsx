/** What this server is called. */

import { useCallback, useId, useState } from 'react';
import { api } from '../../../lib/api.ts';
import { useStore } from '../../../lib/store.ts';
import { Card } from '../../console/Card.tsx';
import { useAdminAction, useAdminData } from '../../console/hooks.ts';

export function GeneralSection({ onError }: { onError: (message: string | null) => void }) {
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);
  const fieldId = useId();
  const hintId = useId();

  const load = useCallback(async () => {
    const settings = await api.admin.settings();
    setName(settings.name);
    return settings;
  }, []);

  const { reload } = useAdminData(load, [], onError, 'Could not load server settings.');
  const act = useAdminAction(onError, reload);

  return (
    <form
      className="console-stack"
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
      {/* The card's title is the field's label — so a click on it puts the cursor in the
          field, as a label's always has — and its description is the field's hint. The
          one setting on the page is not labelled twice. */}
      <Card
        title={<label htmlFor={fieldId}>Server name</label>}
        description="Shown in the top bar, on the sign-in screen, and in invitations."
        descriptionId={hintId}
        footer={
          <button className="btn btn-primary" type="submit">
            {saved ? 'Saved' : 'Save'}
          </button>
        }
      >
        <input
          id={fieldId}
          className="input console-input"
          aria-describedby={hintId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Acme"
        />
      </Card>
    </form>
  );
}
