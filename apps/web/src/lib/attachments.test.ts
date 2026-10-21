// @vitest-environment happy-dom
/** The three-step upload, for a file and for a voice message (M3 · B2). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.ts';
import { newPendingAttachment, uploadFile } from './attachments.ts';

const TICKET = {
  attachmentId: 'a1',
  uploadUrl: 'https://storage.example/put',
  method: 'PUT' as const,
  headers: { 'content-type': 'audio/webm' },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubStorage(ok = true) {
  const put = vi.fn(async () => new Response(null, { status: ok ? 200 : 403 }));
  vi.stubGlobal('fetch', put);
  return put;
}

describe('uploading', () => {
  it('sends a recording as a voice message, with its length and bars', async () => {
    const create = vi.spyOn(api.uploads, 'create').mockResolvedValue(TICKET);
    const complete = vi.spyOn(api.uploads, 'complete').mockResolvedValue({ ok: true });
    const put = stubStorage();
    const file = new File(['ogg'], 'voice.webm', { type: 'audio/webm' });

    const id = await uploadFile(file, 'audio/webm', { durationMs: 3200, waveform: [0, 255] });

    expect(id).toBe('a1');
    expect(create).toHaveBeenCalledWith({
      filename: 'voice.webm',
      mime: 'audio/webm',
      sizeBytes: 3,
      kind: 'voice',
    });
    expect(put).toHaveBeenCalledWith(TICKET.uploadUrl, expect.objectContaining({ body: file }));
    expect(complete).toHaveBeenCalledWith('a1', { durationMs: 3200, waveform: [0, 255] });
  });

  it('asks nothing special for an ordinary file', async () => {
    const create = vi.spyOn(api.uploads, 'create').mockResolvedValue(TICKET);
    const complete = vi.spyOn(api.uploads, 'complete').mockResolvedValue({ ok: true });
    stubStorage();
    await uploadFile(new File(['%PDF'], 'plan.pdf', { type: 'application/pdf' }), 'application/pdf');
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('kind');
    expect(complete).toHaveBeenCalledWith('a1', {});
  });

  it('does not tell the server a refused upload landed', async () => {
    vi.spyOn(api.uploads, 'create').mockResolvedValue(TICKET);
    const complete = vi.spyOn(api.uploads, 'complete');
    stubStorage(false);
    const file = new File(['x'], 'voice.webm', { type: 'audio/webm' });
    await expect(
      uploadFile(file, 'audio/webm', { durationMs: 1000, waveform: [] }),
    ).rejects.toThrow('could not be uploaded');
    expect(complete).not.toHaveBeenCalled();
  });

  it('keeps the details of a recording on the pending chip', () => {
    const file = new File(['x'], 'voice.webm', { type: 'audio/webm' });
    const pending = newPendingAttachment(file, { durationMs: 1000, waveform: [1] });
    expect(pending.voice).toEqual({ durationMs: 1000, waveform: [1] });
    expect(pending.previewUrl).toBeNull();
  });
});
