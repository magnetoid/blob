/** Recording a voice message in the browser (M3 · B2).
 *
 * `MediaRecorder` for the sound, in the first container this browser records that every
 * other browser plays: WebM/Opus in Chrome and Firefox, MP4/AAC in Safari, Ogg/Opus as a
 * last resort. An `AnalyserNode` beside it reads how loud each moment is — drawn live
 * while recording, and kept as the bars the message shows, so nobody has to download the
 * audio to see its shape. The server checks all of it again (`routers/files.py`).
 */

/** The server's ceiling is five minutes and five seconds (`VOICE_MAX_MS`); this leaves
 *  the five seconds for the time it takes a browser to finish the file. */
export const MAX_RECORDING_MS = 5 * 60 * 1000;

/** How many bars a message draws. The server takes 8 to 100. */
export const WAVEFORM_BARS = 64;

const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/webm',
];

export interface Recording {
  blob: Blob;
  /** What the recorder made, codecs and all; the server keeps only the container. */
  mime: string;
  durationMs: number;
  /** `WAVEFORM_BARS` peaks, 0–255. */
  waveform: number[];
}

export function recordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder === 'function' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

export function pickRecordingType(): string | undefined {
  return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/** The file extension a container is saved under. */
export function extensionFor(mime: string): string {
  if (mime.startsWith('audio/mp4')) return 'm4a';
  if (mime.startsWith('audio/ogg')) return 'ogg';
  return 'webm';
}

/** Squeeze any number of loudness samples into `bars` peaks of 0–255. */
export function toWaveform(levels: number[], bars = WAVEFORM_BARS): number[] {
  if (levels.length === 0) return new Array<number>(bars).fill(0);
  const peak = Math.max(...levels, 0.0001);
  const out: number[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    const start = Math.floor((bar * levels.length) / bars);
    const end = Math.max(start + 1, Math.floor(((bar + 1) * levels.length) / bars));
    const slice = levels.slice(start, end);
    const loudest = slice.length ? Math.max(...slice) : 0;
    out.push(Math.round((loudest / peak) * 255));
  }
  return out;
}

/**
 * One recording, from `start` to `stop` (or `cancel`). `onLevel` hears how loud the
 * microphone is, 0–1, about twenty times a second, for the live meter.
 */
export class VoiceRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private timer: number | null = null;
  private limit: number | null = null;
  private chunks: Blob[] = [];
  private levels: number[] = [];
  private startedAt = 0;
  private cancelled = false;
  private finished: ((recording: Recording | null) => void) | null = null;

  /** Rejects with the browser's own error when there is no microphone to be had, and with
   *  an `AbortError` when `cancel` came while the browser was still asking for one. */
  async start(onLevel: (level: number) => void, onLimit: () => void): Promise<void> {
    const type = pickRecordingType();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    // The permission prompt can outlive the composer that asked: whatever let go of this
    // recorder meanwhile must not leave a microphone on with nothing left to turn it off.
    if (this.cancelled) {
      this.release();
      throw new DOMException('The recording was cancelled.', 'AbortError');
    }
    try {
      this.begin(type, onLevel, onLimit);
    } catch (error) {
      this.release();
      throw error;
    }
  }

  private begin(
    type: string | undefined,
    onLevel: (level: number) => void,
    onLimit: () => void,
  ): void {
    if (!this.stream) return;
    this.recorder = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.onstop = () => this.settle();

    this.context = new AudioContext();
    // Made after the permission prompt, so past the click: Safari may make it suspended.
    if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 1024;
    this.context.createMediaStreamSource(this.stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    this.timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const centred = (sample - 128) / 128;
        sum += centred * centred;
      }
      const level = Math.min(1, Math.sqrt(sum / samples.length) * 3);
      this.levels.push(level);
      onLevel(level);
    }, 50);
    this.limit = window.setTimeout(onLimit, MAX_RECORDING_MS);

    this.startedAt = performance.now();
    this.recorder.start(250);
  }

  /** Finish, and answer what was recorded. */
  stop(): Promise<Recording | null> {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
        resolve(null);
        return;
      }
      this.finished = resolve;
      this.recorder.stop();
    });
  }

  /** Throw it away — or, still starting, never begin. */
  cancel(): void {
    this.cancelled = true;
    this.finished = null;
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.release();
  }

  private settle(): void {
    const durationMs = Math.round(performance.now() - this.startedAt);
    const mime = this.recorder?.mimeType || pickRecordingType() || 'audio/webm';
    const recording: Recording = {
      blob: new Blob(this.chunks, { type: mime }),
      mime,
      durationMs: Math.min(durationMs, MAX_RECORDING_MS),
      waveform: toWaveform(this.levels),
    };
    this.release();
    this.finished?.(recording.blob.size > 0 ? recording : null);
    this.finished = null;
  }

  private release(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    if (this.limit !== null) window.clearTimeout(this.limit);
    this.timer = null;
    this.limit = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
