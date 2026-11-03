/** What this server is called, and who may broadcast in it. */

import { useCallback, useId, useState } from 'react';
import { api } from '../../../lib/api.ts';
import { useStore } from '../../../lib/store.ts';
import { Button } from '../../../components/ui/button.tsx';
import { Input } from '../../../components/ui/input.tsx';
import { NativeSelect, NativeSelectOption } from '../../../components/ui/native-select.tsx';
import { Card } from '../../console/Card.tsx';
import { useAdminAction, useAdminData } from '../../console/hooks.ts';

export function GeneralSection({ onError }: { onError: (message: string | null) => void }) {
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);
  const [broadcast, setBroadcast] = useState<'everyone' | 'admins'>('everyone');
  const fieldId = useId();
  const hintId = useId();
  const broadcastId = useId();
  const broadcastHintId = useId();

  const load = useCallback(async () => {
    const settings = await api.admin.settings();
    setName(settings.name);
    setBroadcast(settings.settings.everyoneMentions === 'admins' ? 'admins' : 'everyone');
    return settings;
  }, []);

  const { reload } = useAdminData(load, [], onError, 'Could not load server settings.');
  const act = useAdminAction(onError, reload);

  return (
    <form
      className="flex flex-col gap-6"
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
        footer={<Button type="submit">{saved ? 'Saved' : 'Save'}</Button>}
      >
        <Input
          id={fieldId}
          className="max-w-md"
          aria-describedby={hintId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Acme"
        />
      </Card>

      {/* Who may notify everyone at once (M3 · B3). Saved as it is chosen. */}
      <Card
        title={<label htmlFor={broadcastId}>@channel, @here and @everyone</label>}
        description="Who may notify a whole channel at once. Admins only keeps a big workspace quiet; everybody else can still mention people and groups."
        descriptionId={broadcastHintId}
      >
        <NativeSelect
          id={broadcastId}
          aria-describedby={broadcastHintId}
          value={broadcast}
          onChange={(event) => {
            const next = event.target.value === 'admins' ? 'admins' : 'everyone';
            setBroadcast(next);
            void act(async () => {
              await api.admin.updateSettings({ settings: { everyoneMentions: next } });
              useStore.setState({ everyoneMentions: next });
            });
          }}
        >
          <NativeSelectOption value="everyone">Everyone</NativeSelectOption>
          <NativeSelectOption value="admins">Admins only</NativeSelectOption>
        </NativeSelect>
      </Card>
    </form>
  );
}
