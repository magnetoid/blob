// @vitest-environment happy-dom
/** Sign-in & security: one person's devices and record across every workspace (M3 · B1). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const sessions = vi.fn();
const activity = vi.fn();
const reauthState = vi.fn();
const endSession = vi.fn();
const logoutOthers = vi.fn();
const changePassword = vi.fn();
vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      auth: {
        ...actual.api.auth,
        sessions,
        activity,
        reauthState,
        endSession,
        logoutOthers,
        changePassword,
      },
    },
  };
});

const { SecuritySection } = await import('./SecuritySection.tsx');
const { ApiError } = await import('../../lib/api.ts');

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit Chrome/131.0 Safari/537.36';
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Safari/604.1';

function session(overrides: Record<string, unknown>) {
  return {
    id: 's1',
    current: false,
    userAgent: MAC,
    ip: '198.51.100.7',
    createdAt: '2026-10-20T09:00:00Z',
    lastSeenAt: '2026-10-20T10:00:00Z',
    method: 'password',
    workspaceId: 'w1',
    workspace: 'Acme',
    ...overrides,
  };
}

function serve({
  devices = [session({ id: 'here', current: true })],
  events = [] as unknown[],
  methods = ['password'],
} = {}) {
  sessions.mockResolvedValue({ sessions: devices });
  activity.mockResolvedValue({ events, keepDays: 90 });
  reauthState.mockResolvedValue({ methods, provenAt: null, windowMinutes: 15 });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('where you are signed in', () => {
  it('names the workspace only when there is more than one', async () => {
    serve({
      devices: [
        session({ id: 'here', current: true }),
        session({ id: 'phone', userAgent: PHONE, workspaceId: 'w2', workspace: 'Beta' }),
      ],
    });
    render(<SecuritySection onError={vi.fn()} isOwner={false} />);

    expect(await screen.findByText('Chrome on macOS — this device')).toBeTruthy();
    expect(screen.getByText(/^Beta · signed in with a password · 198\.51\.100\.7/)).toBeTruthy();
  });

  it('signs one device out, and offers it only for the others', async () => {
    serve({
      devices: [session({ id: 'here', current: true }), session({ id: 'phone', userAgent: PHONE })],
    });
    endSession.mockResolvedValue({ ok: true });
    render(<SecuritySection onError={vi.fn()} isOwner={false} />);

    const button = await screen.findByRole('button', { name: 'Sign out Safari on iOS' });
    expect(screen.queryByRole('button', { name: 'Sign out Chrome on macOS' })).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(endSession).toHaveBeenCalledWith('phone'));
    // The list is asked for again, so the device disappears.
    await waitFor(() => expect(sessions).toHaveBeenCalledTimes(2));
  });

  it('has no "everywhere else" when there is nowhere else', async () => {
    serve();
    render(<SecuritySection onError={vi.fn()} isOwner={false} />);
    await screen.findByText('Chrome on macOS — this device');
    expect(screen.queryByText('Sign out everywhere else')).toBeNull();
  });
});

describe('recent activity', () => {
  it('reads as sentences, newest first', async () => {
    serve({
      events: [
        {
          id: 'e2',
          kind: 'failed',
          method: 'password',
          ip: '203.0.113.9',
          userAgent: PHONE,
          workspace: 'Acme',
          createdAt: '2026-10-20T11:00:00Z',
        },
        {
          id: 'e1',
          kind: 'signed_in',
          method: 'password',
          ip: '198.51.100.7',
          userAgent: MAC,
          workspace: 'Acme',
          createdAt: '2026-10-20T09:00:00Z',
        },
      ],
    });
    render(<SecuritySection onError={vi.fn()} isOwner={false} />);

    await screen.findByText('Wrong password entered');
    const lines = [...document.querySelectorAll('[data-kind] .pref-label')].map(
      (node) => node.textContent,
    );
    expect(lines).toEqual(['Wrong password entered', 'Signed in with a password']);
  });
});

describe('changing the password', () => {
  it('needs the current one and says so beside it when wrong', async () => {
    serve();
    changePassword.mockRejectedValue(
      new ApiError(400, 'wrong_password', 'That isn’t your current password.', 'currentPassword'),
    );
    const onError = vi.fn();
    render(<SecuritySection onError={onError} isOwner={false} />);

    fireEvent.change(await screen.findByLabelText('Current password'), {
      target: { value: 'not-it' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'a-long-new-password' },
    });
    fireEvent.click(screen.getByText('Change password'));

    expect(await screen.findByText('That isn’t your current password.')).toBeTruthy();
    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: 'not-it',
      newPassword: 'a-long-new-password',
    });
    expect(onError).not.toHaveBeenCalledWith(expect.stringContaining('current password'));
  });

  it('lets somebody with no password set one without a current one', async () => {
    serve({ methods: [] });
    changePassword.mockResolvedValue({ ok: true });
    render(<SecuritySection onError={vi.fn()} isOwner={false} />);

    await screen.findByText('Set password');
    expect(screen.queryByLabelText('Current password')).toBeNull();
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'a-long-new-password' },
    });
    fireEvent.click(screen.getByText('Set password'));
    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith({
        currentPassword: undefined,
        newPassword: 'a-long-new-password',
      }),
    );
    expect(await screen.findByText(/Password changed/)).toBeTruthy();
  });
});
