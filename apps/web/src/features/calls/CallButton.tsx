/** Start a huddle or a meetup here, or join the one that is on. In the main chunk: it
 * reads the store and nothing of LiveKit, so a channel header costs no call code. */

import { Avatar } from '../../components/Avatar.tsx';
import { HuddleIcon, VideoIcon } from '../../components/Icon.tsx';
import type { CallKind } from '../../lib/api.ts';
import { startCall } from '../../lib/calls.ts';
import { useStore } from '../../lib/store.ts';

export function CallButton({ channelId, kind }: { channelId: string; kind: CallKind }) {
  const live = useStore((s) =>
    Object.values(s.activeCalls).find((call) => call.channelId === channelId && call.kind === kind),
  );
  const mine = useStore((s) => s.callSession?.channelId === channelId && s.callSession.kind === kind);
  const users = useStore((s) => s.users);
  const word = kind === 'meetup' ? 'meetup' : 'huddle';
  const people = live?.participantIds ?? [];
  const label = mine
    ? `You’re in this ${word} — open it`
    : live
      ? `Join the ${word} — ${people.length} in it`
      : `Start a ${word}`;

  return (
    <button
      type="button"
      className="btn pane-call-btn"
      data-live={live ? 'true' : 'false'}
      data-mine={mine ? 'true' : undefined}
      aria-label={label}
      title={label}
      onClick={() => void startCall(channelId, kind)}
    >
      {kind === 'meetup' ? <VideoIcon size="md" /> : <HuddleIcon size="md" />}
      <span className="pane-action-label">
        {mine ? 'In call' : live ? 'Join' : kind === 'meetup' ? 'Meetup' : 'Huddle'}
      </span>
      {people.length > 0 && (
        <span className="call-faces" aria-hidden="true">
          {people.slice(0, 3).map((id) =>
            users[id] ? <Avatar key={id} user={users[id]} size="sm" /> : null,
          )}
          {people.length > 3 && (
            <span key={people.length} className="call-faces-more">
              +{people.length - 3}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
