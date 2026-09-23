/** Microphone, camera, screen, where to show the call, and leave — the bar's and full
 * screen's, so the two cannot drift into two sets of controls. */

import { useLocalParticipant, useTrackToggle, useTrackVolume } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useEffect, useRef } from 'react';
import {
  CollapseIcon,
  ExpandIcon,
  LeaveCallIcon,
  MicIcon,
  MicOffIcon,
  ScreenShareIcon,
  VideoIcon,
  VideoOffIcon,
} from '../../components/Icon.tsx';
import { callPath, leaveCall, type CallSession } from '../../lib/calls.ts';
import { navigate, pathForRoute } from '../../lib/router.ts';
import { useStore } from '../../lib/store.ts';

export function CallControls({ session, where }: { session: CallSession; where: 'bar' | 'full' }) {
  const settings = useStore((s) => s.callSettings);
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const camera = useTrackToggle({ source: Track.Source.Camera });
  const screen = useTrackToggle({
    source: Track.Source.ScreenShare,
    captureOptions: { audio: true },
  });
  const cameraAllowed = session.kind === 'meetup' || settings.huddles.cameras;
  const screenAllowed = session.kind === 'meetup' || settings.huddles.screenShare;

  return (
    <div className="call-controls" role="group" aria-label="Call controls">
      <button
        type="button"
        className="call-ctl call-ctl-av"
        aria-pressed={mic.enabled}
        aria-label={mic.enabled ? 'Mute microphone' : 'Unmute microphone'}
        title={mic.enabled ? 'Mute' : 'Unmute'}
        disabled={mic.pending}
        onClick={() => void mic.toggle()}
      >
        <span className="call-ctl-icon" key={mic.enabled ? 'on' : 'off'}>
          {mic.enabled ? <MicIcon size="md" /> : <MicOffIcon size="md" />}
        </span>
        {mic.enabled && <MicLevel />}
      </button>
      {cameraAllowed && (
        <button
          type="button"
          className="call-ctl call-ctl-av"
          aria-pressed={camera.enabled}
          aria-label={camera.enabled ? 'Turn camera off' : 'Turn camera on'}
          title={camera.enabled ? 'Camera off' : 'Camera on'}
          disabled={camera.pending}
          onClick={() => void camera.toggle()}
        >
          <span className="call-ctl-icon" key={camera.enabled ? 'on' : 'off'}>
            {camera.enabled ? <VideoIcon size="md" /> : <VideoOffIcon size="md" />}
          </span>
        </button>
      )}
      {screenAllowed && (
        <button
          type="button"
          className="call-ctl call-ctl-screen"
          aria-pressed={screen.enabled}
          aria-label={screen.enabled ? 'Stop sharing your screen' : 'Share your screen'}
          title={screen.enabled ? 'Stop sharing' : 'Share screen'}
          disabled={screen.pending}
          onClick={() => void screen.toggle()}
        >
          <ScreenShareIcon size="md" />
        </button>
      )}
      {where === 'bar' ? (
        <button
          type="button"
          className="call-ctl"
          aria-label="Open the call full screen"
          title="Full screen"
          onClick={() => navigate(callPath(session.callId))}
        >
          <ExpandIcon size="md" />
        </button>
      ) : (
        <button
          type="button"
          className="call-ctl"
          aria-label="Back to the conversation"
          title="Back to the conversation"
          onClick={() => navigate(pathForRoute({ view: 'channel', channelId: session.channelId }))}
        >
          <CollapseIcon size="md" />
        </button>
      )}
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
  );
}

/** Three bars that follow your own voice: the answer to "can they hear me?".
 * The level goes on a custom property through a ref — a re-render per sample would be
 * sixty renders a second for three bars. */
function MicLevel() {
  const { microphoneTrack, localParticipant } = useLocalParticipant();
  // `microphoneTrack` is a `TrackPublication`, not the narrower `LocalAudioTrack` that
  // `useTrackVolume` wants, and it is optional besides — so it is passed as a
  // `TrackReference` instead, built only once it is truthy: a `publication` field is
  // required in that shape, and the ternary is what lets TypeScript narrow to that.
  const level = useTrackVolume(
    microphoneTrack
      ? { participant: localParticipant, publication: microphoneTrack, source: Track.Source.Microphone }
      : undefined,
  );
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.style.setProperty('--level', String(Math.min(1, level * 2.5)));
  }, [level]);
  return (
    <span className="call-level" ref={ref} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}
