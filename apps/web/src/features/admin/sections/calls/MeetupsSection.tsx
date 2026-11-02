/** Admin → Calls → Video meetups: whether people here can start one, whether cameras
 * come on when they join, and how many may be in one. */

import { useId, useState } from 'react';
import type { ConsoleSectionProps } from '../../../console/ConsoleShell.tsx';
import { Card, CardFields } from '../../../console/Card.tsx';
import { Field, FieldContent, FieldDescription, FieldLabel } from '../../../../components/ui/field.tsx';
import { Input } from '../../../../components/ui/input.tsx';
import { Switch } from '../../../../components/ui/switch.tsx';
import { MediaServerPanel } from './MediaServerPanel.tsx';
import { useCallSettings } from './useCallSettings.ts';

export function MeetupsSection({ onError, isOwner }: ConsoleSectionProps) {
  const { settings, save } = useCallSettings(onError);
  const id = useId();

  if (!settings) {
    return (
      <div className="flex flex-col gap-6">
        <MediaServerPanel isOwner={isOwner} onError={onError} />
      </div>
    );
  }

  const meetups = settings.meetups;
  const set = (patch: Partial<typeof meetups>) =>
    void save({ ...settings, meetups: { ...meetups, ...patch } });

  return (
    <div className="flex flex-col gap-6">
      <MediaServerPanel isOwner={isOwner} onError={onError} />

      <Card title="In this workspace">
        <CardFields>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor={`${id}-enabled`}>Allow video meetups</FieldLabel>
              <FieldDescription id={`${id}-enabled-hint`}>
                The Meetup button in every channel and DM. Turning it off stops new meetups; one
                already running carries on until the last person leaves.
              </FieldDescription>
            </FieldContent>
            <Switch
              id={`${id}-enabled`}
              aria-describedby={`${id}-enabled-hint`}
              checked={meetups.enabled}
              onCheckedChange={(on) => set({ enabled: on })}
            />
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor={`${id}-cameras`}>Cameras on when people join</FieldLabel>
              <FieldDescription id={`${id}-cameras-hint`}>
                Anyone can still turn theirs off, or on, once they are in.
              </FieldDescription>
            </FieldContent>
            <Switch
              id={`${id}-cameras`}
              aria-describedby={`${id}-cameras-hint`}
              checked={meetups.camerasOnJoin}
              disabled={!meetups.enabled}
              onCheckedChange={(on) => set({ camerasOnJoin: on })}
            />
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor={`${id}-cap`}>Most people in one meetup</FieldLabel>
              <FieldDescription id={`${id}-cap-hint`}>
                Between 2 and 100. LiveKit turns away the next person, and a bigger call needs a
                bigger server — each camera is a stream to every other person.
              </FieldDescription>
            </FieldContent>
            <ParticipantCapField
              id={`${id}-cap`}
              describedBy={`${id}-cap-hint`}
              value={meetups.maxParticipants}
              disabled={!meetups.enabled}
              onCommit={(next) => set({ maxParticipants: next })}
            />
          </Field>
        </CardFields>
      </Card>
    </div>
  );
}

/**
 * A number field controlled off the store rather than `defaultValue` — React ignores a
 * `defaultValue` change after the first render, so a save the server refused used to
 * leave the rejected number on screen forever: the store and the server both still held
 * the old one, and even another admin's own change arriving over the socket never
 * appeared (R43). The switches beside this already read `checked` straight from
 * the store; this reads `value` the same way, keeping only the in-progress keystrokes as
 * local state and dropping them the moment they are no longer needed — on blur, whether
 * the number was rejected here (out of range) or by the server, so this field is exactly
 * as truthful as the switches are.
 */
export function ParticipantCapField({
  id,
  describedBy,
  value,
  disabled,
  onCommit,
}: {
  /** The field's `<label for>` points here: the visible words are its name. */
  id: string;
  /** The hint under those words. */
  describedBy: string;
  value: number;
  disabled: boolean;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <Input
      id={id}
      aria-describedby={describedBy}
      className="w-24"
      type="number"
      min={2}
      max={100}
      disabled={disabled}
      value={draft ?? String(value)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft === null) return;
        const next = Number(draft);
        setDraft(null);
        if (!Number.isInteger(next) || next < 2 || next > 100) return;
        if (next !== value) onCommit(next);
      }}
    />
  );
}
