// @vitest-environment happy-dom
/** Every assistant connected to the workspace, for its admins: whose, and revoking one. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '../../../lib/api.ts';
import { AssistantsAdminSection } from './AssistantsAdminSection.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const TOKEN = {
  id: 't1',
  name: 'Claude Code',
  scopes: ['read', 'write'],
  createdAt: '2026-09-06T09:00:00.000Z',
  lastUsedAt: null,
  expiresAt: '2099-01-02T09:00:00.000Z',
  ownerId: 'u2',
  ownerName: 'Bo',
};

describe('connected assistants', () => {
  it('lists whose each is and what it may do, and revokes one after asking', async () => {
    vi.spyOn(api.admin, 'assistantTokens')
      .mockResolvedValueOnce({ tokens: [TOKEN] })
      .mockResolvedValue({ tokens: [] });
    const revoke = vi.spyOn(api.admin, 'revokeAssistantToken').mockResolvedValue({ ok: true });
    render(<AssistantsAdminSection onError={vi.fn()} isOwner={false} />);

    expect(await screen.findByText(/Bo · Claude Code/)).toBeTruthy();
    expect(screen.getByText('reads and posts')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Revoke Bo.s Claude Code/ }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('t1'));
    expect(await screen.findByText(/Nobody has connected an assistant/)).toBeTruthy();
  });
});
