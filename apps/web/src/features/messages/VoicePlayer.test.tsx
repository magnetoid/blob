// @vitest-environment happy-dom
/** A voice message, played inline (M3 · B2). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Attachment } from '@blob/shared';
import { VoicePlayer } from './VoicePlayer.tsx';
import { useStore } from '../../lib/store.ts';

const VOICE = {
  id: 'a1',
  filename: 'voice.webm',
  mime: 'audio/webm',
  sizeBytes: 4096,
  url: '/api/files/a1',
  kind: 'voice',
  durationMs: 42_000,
  waveform: [0, 64, 128, 255],
  transcriptStatus: 'done',
  transcriptProvider: 'stt:gpt-4o-mini-transcribe',
} as unknown as Attachment;

beforeEach(() => {
  useStore.setState({ transcriptionEnabled: true } as never);
  // happy-dom plays nothing, so the element's state is the test's to keep.
  let paused = true;
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(() => paused);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    paused = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    paused = true;
    this.dispatchEvent(new Event('pause'));
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a voice message', () => {
  it('shows its length and its bars before anything is downloaded', () => {
    const { container } = render(<VoicePlayer attachment={VOICE} />);
    expect(screen.getByText('0:42')).toBeTruthy();
    const levels = [...container.querySelectorAll('.voice-note-bar')].map((bar) =>
      bar.getAttribute('data-level'),
    );
    expect(levels).toEqual(['0', '3', '6', '11']);
    expect(container.querySelector('audio')?.getAttribute('preload')).toBe('none');
  });

  it('plays and pauses from one button', () => {
    render(<VoicePlayer attachment={VOICE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play voice message' }));
    expect(screen.getByRole('button', { name: 'Pause voice message' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pause voice message' }));
    expect(screen.getByRole('button', { name: 'Play voice message' })).toBeTruthy();
  });

  it('is a slider a keyboard can move', () => {
    render(<VoicePlayer attachment={VOICE} />);
    const slider = screen.getByRole('slider', { name: 'Position in the voice message' });
    expect(slider.getAttribute('aria-valuetext')).toBe('0:00 of 0:42');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider.getAttribute('aria-valuetext')).toBe('0:05 of 0:42');
  });

  it('says when its words are still coming, or are not', () => {
    const { rerender } = render(
      <VoicePlayer attachment={{ ...VOICE, transcriptStatus: 'pending' } as Attachment} />,
    );
    expect(screen.getByText('Transcribing…')).toBeTruthy();
    rerender(<VoicePlayer attachment={{ ...VOICE, transcriptStatus: 'failed' } as Attachment} />);
    expect(screen.getByText('No transcript')).toBeTruthy();
  });

  it('promises no words on a server with no speech service', () => {
    useStore.setState({ transcriptionEnabled: false } as never);
    render(<VoicePlayer attachment={{ ...VOICE, transcriptStatus: 'pending' } as Attachment} />);
    expect(screen.queryByText('Transcribing…')).toBeNull();
  });
});
