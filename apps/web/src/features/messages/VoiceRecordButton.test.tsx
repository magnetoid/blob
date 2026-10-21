// @vitest-environment happy-dom
/** The composer's microphone (M3 · B2); the recorder itself is stubbed. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const RECORDING = { blob: new Blob(['x']), mime: 'audio/webm', durationMs: 3200, waveform: [1, 2] };
const start = vi.fn();
const stop = vi.fn(async () => RECORDING);
const cancel = vi.fn();
let supported = true;
vi.mock('../../lib/recorder.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/recorder.ts')>();
  return {
    ...actual,
    recordingSupported: () => supported,
    VoiceRecorder: class {
      start = start;
      stop = stop;
      cancel = cancel;
    },
  };
});

const { VoiceRecordButton } = await import('./VoiceRecordButton.tsx');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  supported = true;
});

describe('recording a voice message', () => {
  it('records, then hands over what it kept', async () => {
    start.mockResolvedValue(undefined);
    const onRecorded = vi.fn();
    render(<VoiceRecordButton onRecorded={onRecorded} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice message' }));
    expect(await screen.findByRole('group', { name: 'Recording a voice message' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Keep the recording' }));
    });
    await waitFor(() => expect(onRecorded).toHaveBeenCalledWith(RECORDING));
    expect(screen.getByRole('button', { name: 'Record a voice message' })).toBeTruthy();
  });

  it('throws one away', async () => {
    start.mockResolvedValue(undefined);
    const onRecorded = vi.fn();
    render(<VoiceRecordButton onRecorded={onRecorded} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice message' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard the recording' }));
    expect(cancel).toHaveBeenCalled();
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('says how to allow the microphone when the browser was told no', async () => {
    start.mockRejectedValue(new DOMException('no', 'NotAllowedError'));
    const onError = vi.fn();
    render(<VoiceRecordButton onRecorded={vi.fn()} onError={onError} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice message' }));
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('needs your microphone')),
    );
    expect(screen.getByRole('button', { name: 'Record a voice message' })).toBeTruthy();
  });

  it('is not offered where the browser cannot record', () => {
    supported = false;
    render(<VoiceRecordButton onRecorded={vi.fn()} onError={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Record a voice message' })).toBeNull();
  });
});
