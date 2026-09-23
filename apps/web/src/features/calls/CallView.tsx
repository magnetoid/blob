/** A call, full screen: everyone's camera and any shared screen, on the same connection
 * as the bar — so "back to the conversation" returns to the bar, not a hang-up. */

import {
  GridLayout,
  ParticipantTile,
  RoomContext,
  useTracks,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track } from 'livekit-client';
import { EmptyState } from '../../components/EmptyState.tsx';
import { leaveCall, startCall } from '../../lib/calls.ts';
import { navigate } from '../../lib/router.ts';
import { useStore } from '../../lib/store.ts';
import { CallControls } from './CallControls.tsx';
import { useCallRoom } from './useCallRoom.ts';

export function CallView({ callId }: { callId: string }) {
  const session = useStore((s) => s.callSession);
  const call = useStore((s) => s.activeCalls[callId]);
  const loaded = useStore((s) => s.callsLoaded);
  const channel = useStore((s) => (call ? s.channels[call.channelId] : undefined));
  const channelTitle = useStore((s) => s.channelTitle);
  const room = useCallRoom();
  const title = channel ? (channel.name ? `#${channel.name}` : channelTitle(channel)) : '';
  const what = call?.kind === 'huddle' ? 'Huddle' : 'Meetup';

  if (!session || session.callId !== callId) {
    if (!loaded) {
      return (
        <main className="pane">
          <EmptyState title="Looking for the call…" />
        </main>
      );
    }
    // A cold load or a link. Browsers play audio only after a gesture, so joining is a
    // click here rather than something that happens on arrival.
    return (
      <main className="pane">
        <EmptyState
          title={call ? `${what} in ${title}` : 'This call has ended'}
          action={
            call ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void startCall(call.channelId, call.kind)}
              >
                Join
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => navigate('/')}>
                Back home
              </button>
            )
          }
        />
      </main>
    );
  }

  if (!room) {
    return (
      <main className="pane call-view">
        {/* A hung token request would otherwise hold this state with no control at all
            — `leaveCall()` cancels a join mid-flight same as it ends a live one. */}
        <EmptyState
          title="Connecting…"
          action={
            <button type="button" className="btn" onClick={() => void leaveCall()}>
              Leave
            </button>
          }
        >
          Setting up a secure connection.
        </EmptyState>
      </main>
    );
  }

  return (
    <RoomContext.Provider value={room}>
      {/* A call surface: `lib/calls.ts`'s `returnFocus` walks up to the nearest one of
          these to decide whether focus is still its to give back (R30). */}
      <main className="pane call-view" data-call-surface="true">
        <header className="call-view-head">
          <h1 className="call-view-title">
            {what} · {title}
          </h1>
          {/* A sibling, not appended inside the title: `.call-view-title` ellipsises on
              overflow, so text appended there is the first thing a narrow header cuts —
              exactly where this is most needed. `flex-shrink: 0` keeps it whole and lets
              the title alone give up width, and no layout jump follows either, since the
              row's height never changes. Same wording the bar uses. */}
          {session.phase === 'reconnecting' && (
            <span className="call-view-status muted">Reconnecting…</span>
          )}
          <CallControls session={session} where="full" />
        </header>
        <CallGrid />
      </main>
    </RoomContext.Provider>
  );
}

function CallGrid() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  // The LiveKit theme belongs to the video, and only the video. It is written for a dark
  // surface and sets a white foreground on everything inside it, so on the whole pane it
  // painted Blob's own header white on white — invisible in a light theme, and found only
  // by looking at the thing in a browser.
  return (
    <div className="call-grid-wrap" data-lk-theme="default">
      <GridLayout tracks={tracks} className="call-grid">
        <ParticipantTile />
      </GridLayout>
    </div>
  );
}
