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
    vi.spyOn(api.admin, 'oauthGrants').mockResolvedValue({ grants: [] });
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
    expect(await screen.findByText(/Nobody has made a token/)).toBeTruthy();
  });
});

describe('connected apps', () => {
  it('names whose each is, and disconnects one after asking', async () => {
    vi.spyOn(api.admin, 'assistantTokens').mockResolvedValue({ tokens: [] });
    vi.spyOn(api.admin, 'oauthGrants')
      .mockResolvedValueOnce({
        grants: [
          {
            id: 'g1',
            clientName: 'ChatGPT',
            vouchedBy: 'chatgpt.com',
            scopes: ['read'],
            createdAt: '2026-10-20T09:00:00.000Z',
            lastUsedAt: null,
            ownerId: 'u2',
            ownerName: 'Bo',
          },
        ],
      })
      .mockResolvedValue({ grants: [] });
    const disconnect = vi
      .spyOn(api.admin, 'disconnectOAuthGrant')
      .mockResolvedValue({ ok: true });
    render(<AssistantsAdminSection onError={vi.fn()} isOwner={false} />);

    expect(await screen.findByText(/Bo · ChatGPT/)).toBeTruthy();
    expect(screen.getByText(/Confirmed by chatgpt\.com/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(disconnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Disconnect Bo.s ChatGPT/ }));
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith('g1'));
    expect(await screen.findByText(/No app has signed in/)).toBeTruthy();
  });
});
