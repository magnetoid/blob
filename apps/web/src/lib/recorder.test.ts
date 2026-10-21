// @vitest-environment happy-dom
/** The recorder's arithmetic: which container, which extension, which bars. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extensionFor,
  pickRecordingType,
  toWaveform,
  VoiceRecorder,
  WAVEFORM_BARS,
} from './recorder.ts';

afterEach(() => vi.unstubAllGlobals());

describe('the container', () => {
  it('prefers WebM/Opus, then MP4 for Safari, then Ogg', () => {
    const supports = (types: string[]) =>
      vi.stubGlobal('MediaRecorder', { isTypeSupported: (type: string) => types.includes(type) });
    supports(['audio/webm;codecs=opus', 'audio/mp4']);
    expect(pickRecordingType()).toBe('audio/webm;codecs=opus');
    supports(['audio/mp4']);
    expect(pickRecordingType()).toBe('audio/mp4');
    supports(['audio/ogg;codecs=opus']);
    expect(pickRecordingType()).toBe('audio/ogg;codecs=opus');
    supports([]);
    expect(pickRecordingType()).toBeUndefined();
  });

  it('names the file after it', () => {
    expect(extensionFor('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionFor('audio/mp4')).toBe('m4a');
    expect(extensionFor('audio/ogg;codecs=opus')).toBe('ogg');
  });
});

describe('the bars', () => {
  it('are always the same number, 0–255, the loudest at the top', () => {
    const bars = toWaveform([0.1, 0.5, 0.2, 1, 0.05, 0.3, 0.4, 0.9, 0.2, 0.1]);
    expect(bars).toHaveLength(WAVEFORM_BARS);
    expect(Math.max(...bars)).toBe(255);
    expect(Math.min(...bars)).toBeGreaterThanOrEqual(0);
  });

  it('squeeze a long recording without losing its peaks', () => {
    const levels = new Array(5000).fill(0.1);
    levels[4321] = 0.8;
    const bars = toWaveform(levels, 64);
    expect(bars.filter((bar) => bar === 255)).toHaveLength(1);
  });

  it('are flat for silence, not missing', () => {
    expect(toWaveform([], 16)).toEqual(new Array(16).fill(0));
  });
});

describe('the microphone', () => {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const contexts: FakeContext[] = [];
  let made = 0;
  let refuse = false;

  class FakeRecorder {
    static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus';
    state: 'inactive' | 'recording' = 'inactive';
    mimeType = 'audio/webm;codecs=opus';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor() {
      made += 1;
      if (refuse) throw new DOMException('no', 'NotSupportedError');
    }
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['sound']) });
      this.onstop?.();
    }
  }

  class FakeContext {
    state = 'running';
    close = vi.fn(async () => undefined);
    constructor() {
      contexts.push(this);
    }
    createAnalyser() {
      return { fftSize: 0, getByteTimeDomainData: (into: Uint8Array) => into.fill(128) };
    }
    createMediaStreamSource() {
      return { connect: () => undefined };
    }
  }

  function stubMedia(getUserMedia: () => Promise<MediaStream>) {
    track.stop.mockClear();
    contexts.length = 0;
    made = 0;
    refuse = false;
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    vi.stubGlobal('AudioContext', FakeContext);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  }

  it('records, then lets go of everything it held', async () => {
    stubMedia(async () => stream);
    const recorder = new VoiceRecorder();
    await recorder.start(vi.fn(), vi.fn());
    const recording = await recorder.stop();
    expect(recording?.mime).toBe('audio/webm;codecs=opus');
    expect(recording?.blob.size).toBeGreaterThan(0);
    expect(recording?.waveform).toHaveLength(WAVEFORM_BARS);
    expect(track.stop).toHaveBeenCalled();
    expect(contexts[0]?.close).toHaveBeenCalled();
  });

  it('turns the microphone off when let go of while the browser was still asking', async () => {
    let grant: (value: MediaStream) => void = () => undefined;
    stubMedia(() => new Promise((resolve) => (grant = resolve)));
    const recorder = new VoiceRecorder();
    const started = recorder.start(vi.fn(), vi.fn());
    recorder.cancel(); // the composer went away with the prompt still open
    grant(stream);
    await expect(started).rejects.toMatchObject({ name: 'AbortError' });
    expect(track.stop).toHaveBeenCalled();
    expect(made).toBe(0);
  });

  it('turns the microphone off when the recorder will not start', async () => {
    stubMedia(async () => stream);
    refuse = true;
    await expect(new VoiceRecorder().start(vi.fn(), vi.fn())).rejects.toMatchObject({
      name: 'NotSupportedError',
    });
    expect(track.stop).toHaveBeenCalled();
  });
});
