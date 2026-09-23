/** The call's audio, and nothing else — mounted once for the whole page's life, outside
 * every one of Workspace's three branches, so crossing the shell/console boundary
 * mid-call does not remount it and cut the call's sound for the length of a route change
 * (R31). `CallDock`'s bar has its own, separate `RoomContext.Provider`: this is the only
 * `RoomAudioRenderer` in the tree, and it has to stay that way, or the call plays twice. */

import { RoomAudioRenderer, RoomContext } from '@livekit/components-react';
import { useCallRoom } from './useCallRoom.ts';

export function CallAudio() {
  const room = useCallRoom();
  if (!room) return null;
  return (
    <RoomContext.Provider value={room}>
      <RoomAudioRenderer />
    </RoomContext.Provider>
  );
}
