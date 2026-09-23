/** The call you are in, while you do something else: where it is, who is in it, who is
 * talking, and the controls. At the foot of the channel list; across the top below 768px. */

import { useIsSpeaking, useParticipants } from '@livekit/components-react';
import type { Participant } from 'livekit-client';
import { Avatar } from '../../components/Avatar.tsx';
import type { CallSession } from '../../lib/calls.ts';
import { navigate, pathForRoute } from '../../lib/router.ts';
import { useStore } from '../../lib/store.ts';
import { CallControls } from './CallControls.tsx';

export function CallBar({ session }: { session: CallSession }) {
  const channel = useStore((s) => s.channels[session.channelId]);
  const channelTitle = useStore((s) => s.channelTitle);
  const title = channel ? (channel.name ? `#${channel.name}` : channelTitle(channel)) : 'Call';
  const what = session.kind === 'huddle' ? 'Huddle' : 'Meetup';

  return (
    <section className="call-bar" data-phase={session.phase} aria-label={`${what} in ${title}`}>
      <button
        type="button"
        className="call-bar-where"
        onClick={() => navigate(pathForRoute({ view: 'channel', channelId: session.channelId }))}
      >
        <span className="call-bar-live" aria-hidden="true" />
        <span className="call-bar-title">
          {session.phase === 'connecting'
            ? 'Connecting…'
            : session.phase === 'reconnecting'
              ? 'Reconnecting…'
              : `${what} · ${title}`}
        </span>
      </button>
      <CallPeople />
      <CallControls session={session} where="bar" />
    </section>
  );
}

function CallPeople() {
  const participants = useParticipants();
  return (
    // The count used to sit inside the <ul> as a trailing <span> — invalid markup, a
    // <ul> may hold only <li> children. `.call-people` keeps the outer row (still what
    // the collapsed-sidebar and narrow-width rules hide as a whole); the list itself
    // gets its own class for the flex/list-reset styling that used to live here.
    <div className="call-people">
      <ul className="call-people-list" aria-label={`${participants.length} in the call`}>
        {participants.map((participant) => (
          <CallPerson key={participant.identity} participant={participant} />
        ))}
      </ul>
      <span key={participants.length} className="call-people-count" aria-hidden="true">
        {participants.length}
      </span>
    </div>
  );
}

function CallPerson({ participant }: { participant: Participant }) {
  const user = useStore((s) => s.users[participant.identity]);
  const speaking = useIsSpeaking(participant);
  const name = user?.displayName ?? participant.name ?? 'Someone';
  return (
    <li className="call-person" data-speaking={speaking ? 'true' : 'false'} title={name}>
      {user ? <Avatar user={user} size="sm" /> : <span className="call-person-initial">{name[0]}</span>}
      <span className="sr-only">{speaking ? `${name}, speaking` : name}</span>
    </li>
  );
}
