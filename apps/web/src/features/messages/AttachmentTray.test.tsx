// @vitest-environment happy-dom
/** The chips above the message field, for a file and for a recording (M3 · B2). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AttachmentTray } from './AttachmentTray.tsx';
import type { PendingAttachment } from '../../lib/attachments.ts';

const FILE: PendingAttachment = {
  key: 'k1',
  attachmentId: 'a1',
  filename: 'plan.pdf',
  sizeBytes: 2048,
  mime: 'application/pdf',
  previewUrl: null,
  status: 'ready',
  error: null,
};
const VOICE: PendingAttachment = {
  ...FILE,
  key: 'k2',
  filename: 'voice-2026-10-21-09-30-00.webm',
  mime: 'audio/webm',
  voice: { durationMs: 65_000, waveform: [] },
};

afterEach(cleanup);

describe('the attachment tray', () => {
  it('names a recording by what it is and how long it runs', () => {
    render(<AttachmentTray attachments={[FILE, VOICE]} onDiscard={vi.fn()} />);
    expect(screen.getByText('plan.pdf')).toBeTruthy();
    expect(screen.getByText('2 KB')).toBeTruthy();
    expect(screen.getByText('Voice message')).toBeTruthy();
    expect(screen.getByText('1:05')).toBeTruthy();
    expect(screen.queryByText(VOICE.filename)).toBeNull();
  });

  it('removes a recording by its key', () => {
    const onDiscard = vi.fn();
    render(<AttachmentTray attachments={[VOICE]} onDiscard={onDiscard} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove voice message' }));
    expect(onDiscard).toHaveBeenCalledWith('k2');
  });
});
