/** A voice message in a conversation (M3 · B2): play it, see its shape, see how far in.
 *
 * The bars are the ones measured while it was recorded, so drawing them costs no
 * download; the audio itself is fetched only when somebody presses play. The words, once
 * the speech service has them, are the message's own text — this shows only whether
 * they are still coming, or are not going to.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { Attachment } from '@blob/shared';
import { PauseIcon, PlayIcon } from '../../components/Icon.tsx';
import { formatDuration } from '../../lib/format.ts';
import { useStore } from '../../lib/store.ts';

/** What a recording with no bars draws: an even, quiet line. */
const FLAT = new Array<number>(48).fill(48);

/** A bar's height as one of twelve steps, so the stylesheet draws it (`data-level`). */
function level(value: number): number {
  return Math.max(0, Math.min(11, Math.round((value / 255) * 11)));
}

export function VoicePlayer({
  attachment,
  arrived = false,
}: {
  attachment: Attachment;
  /** Turned up after the row was first drawn, so it enters (the list's motion rule). */
  arrived?: boolean;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const transcriptionEnabled = useStore((s) => s.transcriptionEnabled);
  const total = attachment.durationMs ?? 0;
  const bars = attachment.waveform?.length ? attachment.waveform : FLAT;
  const progress = total > 0 ? Math.min(1, position / total) : 0;

  useEffect(() => {
    const node = audio.current;
    if (!node) return undefined;
    const time = () => setPosition(node.currentTime * 1000);
    const play = () => setPlaying(true);
    const pause = () => setPlaying(false);
    const ended = () => {
      setPlaying(false);
      setPosition(0);
    };
    node.addEventListener('timeupdate', time);
    node.addEventListener('play', play);
    node.addEventListener('pause', pause);
    node.addEventListener('ended', ended);
    return () => {
      node.removeEventListener('timeupdate', time);
      node.removeEventListener('play', play);
      node.removeEventListener('pause', pause);
      node.removeEventListener('ended', ended);
    };
  }, []);

  function toggle() {
    const node = audio.current;
    if (!node) return;
    if (node.paused) void node.play().catch(() => setPlaying(false));
    else node.pause();
  }

  function seekTo(fraction: number) {
    const node = audio.current;
    if (!node || total <= 0) return;
    const at = Math.max(0, Math.min(1, fraction)) * (total / 1000);
    node.currentTime = at;
    setPosition(at * 1000);
  }

  function onBarsClick(event: MouseEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width > 0) seekTo((event.clientX - box.left) / box.width);
  }

  function onBarsKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = 5000 / Math.max(total, 1);
    if (event.key === 'ArrowRight') seekTo(progress + step);
    else if (event.key === 'ArrowLeft') seekTo(progress - step);
    else if (event.key === ' ' || event.key === 'Enter') toggle();
    else return;
    event.preventDefault();
  }

  return (
    <div
      className="voice-note"
      data-playing={playing ? 'true' : undefined}
      data-arrived={arrived ? 'true' : undefined}
    >
      <button
        type="button"
        className="voice-note-play"
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        onClick={toggle}
      >
        {playing ? <PauseIcon size="md" /> : <PlayIcon size="md" />}
      </button>
      <div
        className="voice-note-bars"
        role="slider"
        tabIndex={0}
        aria-label="Position in the voice message"
        aria-valuemin={0}
        aria-valuemax={Math.round(total / 1000)}
        aria-valuenow={Math.round(position / 1000)}
        aria-valuetext={`${formatDuration(position)} of ${formatDuration(total)}`}
        onClick={onBarsClick}
        onKeyDown={onBarsKey}
      >
        {bars.map((value, index) => (
          <span
            // The bars never reorder: their position is their identity.
            key={index}
            className="voice-note-bar"
            data-level={level(value)}
            data-played={index / bars.length < progress ? 'true' : undefined}
          />
        ))}
      </div>
      <span className="voice-note-time">
        {playing || position > 0 ? formatDuration(position) : formatDuration(total)}
      </span>
      {transcriptionEnabled && attachment.transcriptStatus === 'pending' && (
        <span className="voice-note-status">Transcribing…</span>
      )}
      {attachment.transcriptStatus === 'failed' && (
        <span className="voice-note-status">No transcript</span>
      )}
      {/* Its words are the message's own text, once transcribed: a <track> would repeat
          them, with timings nobody measured. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audio} src={attachment.url} preload="none" />
    </div>
  );
}
