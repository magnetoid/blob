/** What has to stay mounted for as long as you are in a call: the bar. Mounted by
 * Workspace from the first join on, so leaving can animate the bar out. The room's audio
 * is `CallAudio`, mounted once for the page's own life rather than once per Workspace
 * branch — see its own comment for why it had to move out of here (R31). */

import { RoomContext } from '@livekit/components-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { LeaveCallIcon } from '../../components/Icon.tsx';
import { leaveCall } from '../../lib/calls.ts';
import { usePresence } from '../../lib/usePresence.ts';
import { useStore } from '../../lib/store.ts';
import { CallBar } from './CallBar.tsx';
import { useCallRoom } from './useCallRoom.ts';

export function CallDock({
  fullScreen,
  floating = false,
  onPresence,
}: {
  fullScreen: boolean;
  /** The consoles have no channel list to stand in, so there the bar floats in a corner. */
  floating?: boolean;
  /** Reports whether the bar is on screen, so the shell keeps its row until it is gone. */
  onPresence: (present: boolean) => void;
}) {
  const room = useCallRoom();
  const session = useStore((s) => s.callSession);
  const node = useRef<HTMLDivElement>(null);
  const { present, state } = usePresence(Boolean(session) && !fullScreen, node);
  // A layout effect, so the shell drops the row in the same frame the bar goes — an
  // ordinary effect would paint one frame of an empty row.
  useLayoutEffect(() => onPresence(present), [present, onPresence]);

  // Held through the exit, the way `DialogPresence` holds its value
  // (`components/Dialog.tsx`): `session` goes null on the very render `usePresence`
  // turns to `state='closed'`, and a dock gated on `session` itself would never create
  // the element there is anything left to animate. Adjusted during render, not in an
  // effect — an effect lands a commit late, drawing one frame from the value that was
  // just cleared.
  const [heldSession, setHeldSession] = useState(session);
  const [heldRoom, setHeldRoom] = useState(room);
  if (session && heldSession !== session) {
    // A new call, not just a phase change to the one already held — `heldSession` and
    // `heldRoom` are keyed together, and forgetting only one of them would let a fast
    // rejoin pass a brand-new session into a `RoomContext` still holding the last call's
    // now-disconnected room. `room` is not synchronous with `session` the way a phase
    // change is (joining awaits a token and a `connect()`), so this render's `room` is
    // still the *old* room, not yet nulled — held is reset here, ahead of the ordinary
    // sync below, rather than waiting for a live `room` that has nothing to overwrite it
    // with until the new call actually connects.
    //
    // A different call id is not the only way that happens: `startCall` POSTs
    // start-or-join and the server hands back the live row, so leaving and pressing
    // Join again on the same call returns the *same* call id — the commoner rejoin, not
    // the rarer one. A fresh `connecting` session with no room yet is that case, caught
    // alongside it; a reconnect (`reconnecting`, not `connecting`) is not, because that
    // room usually is still the right one to keep painting.
    if (heldSession?.callId !== session.callId || (session.phase === 'connecting' && !room))
      setHeldRoom(null);
    setHeldSession(session);
  }
  // `room` goes null synchronously on every exit path (`engine.ts`'s `drop()` publishes
  // null before disconnecting, and again before `onEnded`), so painting from the live
  // `room` during the exit swaps the real bar for the "Connecting…" strip — its own
  // 160ms entrance playing while the dock fades out, exactly backwards from R29. Held
  // the same way `heldSession` is, and read below in its place.
  if (room && heldRoom !== room) setHeldRoom(room);

  // The dock is its own element only while there is a bar in it: an empty grid child
  // would still claim the shell's third row. The ref sits on the element that carries
  // `data-state`, because `usePresence` waits for `animationend` on that node itself.
  // Existence follows `present` (and the held session, so there is something to draw),
  // not the live `session`, which is exactly the value that goes null too early.
  if (!present || !heldSession) return null;

  return (
    <div
      className="call-dock"
      ref={node}
      data-state={state}
      data-floating={floating ? 'true' : undefined}
      // A call surface: `lib/calls.ts`'s `returnFocus` walks up to the nearest one of
      // these to decide whether focus is still its to give back (R30).
      data-call-surface="true"
      inert={state === 'closed' ? true : undefined}
    >
      {heldRoom ? (
        <RoomContext.Provider value={heldRoom}>
          <CallBar session={heldSession} />
        </RoomContext.Provider>
      ) : (
        <section className="call-bar" data-phase="connecting" aria-label="Connecting to the call">
          <span className="call-bar-where">
            <span className="call-bar-live" aria-hidden="true" />
            <span className="call-bar-title">Connecting…</span>
          </span>
          {/* A hung token request would otherwise hold this state with no control at
              all — `leaveCall()` cancels a join mid-flight same as it ends a live one. */}
          <div className="call-controls">
            <button
              type="button"
              className="call-ctl call-leave"
              aria-label="Leave the call"
              title="Leave"
              onClick={() => void leaveCall()}
            >
              <LeaveCallIcon size="md" />
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
