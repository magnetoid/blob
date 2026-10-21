/** Admin → Calls → Huddles: whether people here can start one, what they may share in
 * it, and how many may be in one. A huddle is the light call — audio first, in the bar,
 * started from a conversation's header — where a meetup is the full-screen one. */

import type { ConsoleSectionProps } from '../../../console/ConsoleShell.tsx';
import { Card } from '../../../console/Card.tsx';
import { MediaServerPanel } from './MediaServerPanel.tsx';
import { ParticipantCapField } from './MeetupsSection.tsx';
import { useCallSettings } from './useCallSettings.ts';

export function HuddlesSection({ onError, isOwner }: ConsoleSectionProps) {
  const { settings, save } = useCallSettings(onError);

  if (!settings) {
    return (
      <div className="console-stack">
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
    <div className="console-stack">
      <MediaServerPanel isOwner={isOwner} onError={onError} />

      <Card title="In this workspace">
        <div className="pref-row">
          <div className="grow">
            <div className="pref-label">Allow huddles</div>
            <div className="pref-hint">
              The Huddle button in every channel and DM. Turning it off stops new huddles; one
              already running carries on until the last person leaves.
            </div>
          </div>
          <button
            className="toggle"
            aria-pressed={huddles.enabled}
            aria-label="Allow huddles"
            onClick={() => set({ enabled: !huddles.enabled })}
          >
            <span />
          </button>
        </div>

        <div className="pref-row">
          <div className="grow">
            <div className="pref-label">Cameras in huddles</div>
            <div className="pref-hint">
              A huddle starts with microphones only. On, anyone in it may turn a camera on.
            </div>
          </div>
          <button
            className="toggle"
            aria-pressed={huddles.cameras}
            aria-label="Cameras in huddles"
            disabled={!huddles.enabled}
            onClick={() => set({ cameras: !huddles.cameras })}
          >
            <span />
          </button>
        </div>

        <div className="pref-row">
          <div className="grow">
            <div className="pref-label">Screen sharing in huddles</div>
            <div className="pref-hint">A shared screen carries its sound too.</div>
          </div>
          <button
            className="toggle"
            aria-pressed={huddles.screenShare}
            aria-label="Screen sharing in huddles"
            disabled={!huddles.enabled}
            onClick={() => set({ screenShare: !huddles.screenShare })}
          >
            <span />
          </button>
        </div>

        <div className="pref-row">
          <div className="grow">
            <div className="pref-label">Most people in one huddle</div>
            <div className="pref-hint">
              Between 2 and 100. LiveKit turns away the next person; voices are light, but every
              camera and screen is a stream to everybody else.
            </div>
          </div>
          <ParticipantCapField
            label="Most people in one huddle"
            value={huddles.maxParticipants}
            disabled={!huddles.enabled}
            onCommit={(next) => set({ maxParticipants: next })}
          />
        </div>
      </Card>
    </div>
  );
}
