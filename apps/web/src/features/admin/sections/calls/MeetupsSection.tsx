/** Admin → Calls → Video meetups: whether people here can start one, whether cameras
 * come on when they join, and how many may be in one. */

import { useState } from 'react';
import type { ConsoleSectionProps } from '../../../console/ConsoleShell.tsx';
import { Card } from '../../../console/Card.tsx';
import { MediaServerPanel } from './MediaServerPanel.tsx';
import { useCallSettings } from './useCallSettings.ts';

export function MeetupsSection({ onError, isOwner }: ConsoleSectionProps) {
  const { settings, save } = useCallSettings(onError);

  if (!settings) {
    return (
      <div className="console-stack">
        <MediaServerPanel isOwner={isOwner} onError={onError} />
      </div>
    );
  }

  const meetups = settings.meetups;
  const set = (patch: Partial<typeof meetups>) =>
    void save({ ...settings, meetups: { ...meetups, ...patch } });

  return (
    <div className="console-stack">
      <MediaServerPanel isOwner={isOwner} onError={onError} />

      <Card title="In this workspace">
        <div className="pref-row">
          <div className="grow">
            <div className="pref-label">Allow video meetups</div>
            <div className="pref-hint">
              The Meetup button in every channel and DM. Turning it off stops new meetups; one
              already running carries on until the last person leaves.
            </div>
          </div>
          <button
            className="toggle"
            aria-pressed={meetups.enabled}
            aria-label="Allow video meetups"
            onClick={() => set({ enabled: !meetups.enabled })}
          >
            <span />
          </button>
        </div>

        <div className="pref-row">
          <div className="grow">
            <div className="pref-label">Cameras on when people join</div>
            <div className="pref-hint">Anyone can still turn theirs off, or on, once they are in.</div>
          </div>
          <button
            className="toggle"
            aria-pressed={meetups.camerasOnJoin}
            aria-label="Cameras on when people join"
            disabled={!meetups.enabled}
            onClick={() => set({ camerasOnJoin: !meetups.camerasOnJoin })}
          >
            <span />
          </button>
        </div>

        <div className="pref-row">
          <div className="grow">
            <div className="pref-label">Most people in one meetup</div>
            <div className="pref-hint">
              Between 2 and 100. LiveKit turns away the next person, and a bigger call needs a
              bigger server — each camera is a stream to every other person.
            </div>
          </div>
          <ParticipantCapField
            value={meetups.maxParticipants}
            disabled={!meetups.enabled}
            onCommit={(next) => set({ maxParticipants: next })}
          />
        </div>
      </Card>
    </div>
  );
}

/**
 * A number field controlled off the store rather than `defaultValue` — React ignores a
 * `defaultValue` change after the first render, so a save the server refused used to
 * leave the rejected number on screen forever: the store and the server both still held
 * the old one, and even another admin's own change arriving over the socket never
 * appeared (R43). The two toggles beside this already read `aria-pressed` straight from
 * the store; this reads `value` the same way, keeping only the in-progress keystrokes as
 * local state and dropping them the moment they are no longer needed — on blur, whether
 * the number was rejected here (out of range) or by the server, so this field is exactly
 * as truthful as the toggles are.
 */
function ParticipantCapField({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      className="input console-input-number"
      type="number"
      min={2}
      max={100}
      aria-label="Most people in one meetup"
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
