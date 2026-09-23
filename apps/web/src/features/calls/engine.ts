/** The LiveKit connection for the call you are in: one Room, outside React.
 *
 * Outside React because the same call is shown in more than one place — the bar and full
 * screen — and they mount and unmount as you move around. A Room owned by any of them
 * hangs up when it unmounts, which is exactly what the first meetup view did: opening a
 * channel mid-meeting ended your part in it.
 *
 * Ownership is per *attempt*, not per call: `pending` is the newest `connect()`, `current`
 * is the one actually in use. A leave, a rejoin or a switch can each land while an older
 * attempt is still connecting, still fetching a token upstream, or still waiting on the
 * microphone prompt — and whichever attempt is no longer `pending`/`current` by the time
 * it finishes is disconnected and reported nowhere, rather than publishing over a newer
 * room or firing `onEnded` for a room nobody is in any more.
 */

import { Room, RoomEvent } from 'livekit-client';

export interface ConnectOptions {
  camera: boolean;
  onPhase: (phase: 'connected' | 'reconnecting') => void;
  /** The room is gone: you left, the call was ended, or the network did not come back. */
  onEnded: () => void;
  onDeviceError: (device: 'microphone' | 'camera', error: unknown) => void;
}

let current: Room | null = null;
let pending: Room | null = null;
const listeners = new Set<() => void>();

function publish(room: Room | null): void {
  current = room;
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function room(): Room | null {
  return current;
}

/** Take every room out of use at once, before anything awaits. */
function drop(): Room[] {
  const dropped = [current, pending].filter((room): room is Room => room !== null);
  pending = null;
  if (current) publish(null);
  return dropped;
}

export async function connect(url: string, token: string, options: ConnectOptions): Promise<void> {
  const leaving = drop();
  const next = new Room({ adaptiveStream: true, dynacast: true });
  pending = next; // claimed before any await: the newest connect() wins, whatever order awaits resolve in
  next.on(RoomEvent.Reconnecting, () => {
    if (current === next) options.onPhase('reconnecting');
  });
  next.on(RoomEvent.Reconnected, () => {
    if (current === next) options.onPhase('connected');
  });
  next.on(RoomEvent.Disconnected, () => {
    // A room dropped on purpose (left, replaced) says nothing — livekit-client emits
    // Disconnected for those too, including one aborted mid-connect. Only the room in use
    // reports that the call is over for you.
    if (current !== next) return;
    publish(null);
    options.onEnded();
  });
  await Promise.all(leaving.map((room) => room.disconnect()));
  if (pending !== next) return;
  try {
    await next.connect(url, token);
  } catch (error) {
    if (pending !== next) return; // aborted by a leave or a newer connect: not a failure
    pending = null;
    throw error;
  }
  if (pending !== next) {
    // Connected after it was left or replaced: nobody owns this room.
    await next.disconnect();
    return;
  }
  pending = null;
  publish(next);
  options.onPhase('connected'); // connected now — the microphone prompt is a separate matter
  try {
    await next.localParticipant.setMicrophoneEnabled(true);
  } catch (error) {
    if (current === next) options.onDeviceError('microphone', error);
  }
  if (options.camera && current === next) {
    try {
      await next.localParticipant.setCameraEnabled(true);
    } catch (error) {
      if (current === next) options.onDeviceError('camera', error);
    }
  }
}

export async function disconnect(): Promise<void> {
  await Promise.all(drop().map((room) => room.disconnect()));
}
