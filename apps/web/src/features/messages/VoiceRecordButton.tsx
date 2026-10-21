/** Recording a voice message from the composer (M3 · B2).
 *
 * A microphone beside Attach. Pressed, it becomes the recording: a red dot, the time, the
 * microphone's level, and two ways out — throw it away, or keep it. Kept, the recording
 * lands in the tray like a file and goes with the next send, so it can be played back,
 * removed or sent the way anything else in the tray is.
 */

import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CloseIcon, MicIcon } from '../../components/Icon.tsx';
import { formatDuration } from '../../lib/format.ts';
import { recordingSupported, VoiceRecorder, type Recording } from '../../lib/recorder.ts';

type State = 'idle' | 'starting' | 'recording';

/** How many recent levels the live meter draws. */
const METER_BARS = 20;

export function VoiceRecordButton({
  onRecorded,
  onError,
}: {
  onRecorded: (recording: Recording) => void;
  onError: (message: string | null) => void;
}) {
  const [state, setState] = useState<State>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const recorder = useRef<VoiceRecorder | null>(null);
  const startedAt = useRef(0);

  // The clock, while it records.
  useEffect(() => {
    if (state !== 'recording') return undefined;
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAt.current), 200);
    return () => window.clearInterval(timer);
  }, [state]);

  // Leaving the conversation mid-recording throws it away and lets go of the microphone.
  useEffect(
    () => () => {
      recorder.current?.cancel();
      recorder.current = null;
    },
    [],
  );

  if (!recordingSupported()) return null;

  async function start() {
    onError(null);
    setState('starting');
    const next = new VoiceRecorder();
    recorder.current = next;
    try {
      await next.start(
        (level) => setLevels((current) => [...current.slice(1 - METER_BARS), level]),
        () => void finish(),
      );
      startedAt.current = Date.now();
      setElapsed(0);
      setLevels([]);
      setState('recording');
    } catch (err) {
      recorder.current = null;
      setState('idle');
      // Let go of while the browser was asking: nobody is waiting to be told.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      onError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Blob needs your microphone to record. Allow it in your browser’s settings for this site.'
          : 'Your microphone could not be started.',
      );
    }
  }

  async function finish() {
    const current = recorder.current;
    recorder.current = null;
    setState('idle');
    const recording = await current?.stop();
    if (recording && recording.durationMs >= 500) onRecorded(recording);
  }

  function discard() {
    recorder.current?.cancel();
    recorder.current = null;
    setState('idle');
  }

  if (state !== 'recording') {
    return (
      <button
        className="icon-btn"
        type="button"
        aria-label="Record a voice message"
        data-tooltip="Record a voice message"
        data-tooltip-place="top"
        disabled={state === 'starting'}
        onClick={() => void start()}
      >
        <MicIcon />
      </button>
    );
  }

  return (
    <div className="voice-recording" role="group" aria-label="Recording a voice message">
      <span className="voice-recording-dot" aria-hidden="true" />
      <span className="voice-recording-time" aria-live="off">
        {formatDuration(elapsed)}
      </span>
      <span className="voice-recording-meter" aria-hidden="true">
        {levels.map((value, index) => (
          <span key={index} data-level={Math.round(Math.min(1, value) * 11)} />
        ))}
      </span>
      <button
        className="icon-btn"
        type="button"
        aria-label="Discard the recording"
        data-tooltip="Discard"
        data-tooltip-place="top"
        onClick={discard}
      >
        <CloseIcon />
      </button>
      <button
        className="icon-btn voice-recording-done"
        type="button"
        aria-label="Keep the recording"
        data-tooltip="Done"
        data-tooltip-place="top"
        onClick={() => void finish()}
      >
        <CheckIcon />
      </button>
    </div>
  );
}
