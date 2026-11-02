/** Admin → Calls → Huddles: whether people here can start one, what they may share in
 * it, and how many may be in one. A huddle is the light call — audio first, in the bar,
 * started from a conversation's header — where a meetup is the full-screen one. */

import { useId } from 'react';
import type { ConsoleSectionProps } from '../../../console/ConsoleShell.tsx';
import { Card, CardFields } from '../../../console/Card.tsx';
import { Field, FieldContent, FieldDescription, FieldLabel } from '../../../../components/ui/field.tsx';
import { Switch } from '../../../../components/ui/switch.tsx';
import { MediaServerPanel } from './MediaServerPanel.tsx';
import { ParticipantCapField } from './MeetupsSection.tsx';
import { useCallSettings } from './useCallSettings.ts';

export function HuddlesSection({ onError, isOwner }: ConsoleSectionProps) {
  const { settings, save } = useCallSettings(onError);
  const id = useId();

  if (!settings) {
    return (
      <div className="flex flex-col gap-6">
        <MediaServerPanel isOwner={isOwner} onError={onError} />
      </div>
    );
  }

  const huddles = settings.huddles;
  // The whole settings object goes back: the server replaces it, and sending the huddles
  // half alone would reset the meetups half to its defaults.
  const set = (patch: Partial<typeof huddles>) =>
    void save({ ...settings, huddles: { ...huddles, ...patch } });

  return (
    <div className="flex flex-col gap-6">
      <MediaServerPanel isOwner={isOwner} onError={onError} />

      <Card title="In this workspace">
        <CardFields>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor={`${id}-enabled`}>Allow huddles</FieldLabel>
              <FieldDescription id={`${id}-enabled-hint`}>
                The Huddle button in every channel and DM. Turning it off stops new huddles; one
                already running carries on until the last person leaves.
              </FieldDescription>
            </FieldContent>
            <Switch
              id={`${id}-enabled`}
              aria-describedby={`${id}-enabled-hint`}
              checked={huddles.enabled}
              onCheckedChange={(on) => set({ enabled: on })}
            />
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor={`${id}-cameras`}>Cameras in huddles</FieldLabel>
              <FieldDescription id={`${id}-cameras-hint`}>
                A huddle starts with microphones only. On, anyone in it may turn a camera on.
              </FieldDescription>
            </FieldContent>
            <Switch
              id={`${id}-cameras`}
              aria-describedby={`${id}-cameras-hint`}
              checked={huddles.cameras}
              disabled={!huddles.enabled}
              onCheckedChange={(on) => set({ cameras: on })}
            />
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor={`${id}-screen`}>Screen sharing in huddles</FieldLabel>
              <FieldDescription id={`${id}-screen-hint`}>
                A shared screen carries its sound too.
              </FieldDescription>
            </FieldContent>
            <Switch
              id={`${id}-screen`}
              aria-describedby={`${id}-screen-hint`}
              checked={huddles.screenShare}
              disabled={!huddles.enabled}
              onCheckedChange={(on) => set({ screenShare: on })}
            />
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor={`${id}-cap`}>Most people in one huddle</FieldLabel>
              <FieldDescription id={`${id}-cap-hint`}>
                Between 2 and 100. LiveKit turns away the next person; voices are light, but every
                camera and screen is a stream to everybody else.
              </FieldDescription>
            </FieldContent>
            <ParticipantCapField
              id={`${id}-cap`}
              describedBy={`${id}-cap-hint`}
              value={huddles.maxParticipants}
              disabled={!huddles.enabled}
              onCommit={(next) => set({ maxParticipants: next })}
            />
          </Field>
        </CardFields>
      </Card>
    </div>
  );
}
