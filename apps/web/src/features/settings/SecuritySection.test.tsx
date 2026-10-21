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
const passkeyList = vi.fn();
const passkeyOptions = vi.fn();
const passkeyAdd = vi.fn();
const passkeyRemove = vi.fn();
const setTwoStep = vi.fn();
const ssoIdentities = vi.fn();
const ssoUnlink = vi.fn();
const ssoBegin = vi.fn();
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
      passkeys: {
        ...actual.api.passkeys,
        list: passkeyList,
        options: passkeyOptions,
        add: passkeyAdd,
        remove: passkeyRemove,
        setTwoStep,
      },
      sso: { identities: ssoIdentities, unlink: ssoUnlink, begin: ssoBegin },
    },
  };
});

const createPasskey = vi.fn();
const forgetPasskey = vi.fn();
vi.mock('../../lib/passkeys.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/passkeys.ts')>();
  return {
    ...actual,
    passkeysSupported: () => true,
    createPasskey: (...args: unknown[]) => createPasskey(...args),
    forgetPasskey: (...args: unknown[]) => forgetPasskey(...args),
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
  passkeys = [] as unknown[],
  twoStep = false,
} = {}) {
  sessions.mockResolvedValue({ sessions: devices });
  activity.mockResolvedValue({ events, keepDays: 90 });
  reauthState.mockResolvedValue({ methods, provenAt: null, windowMinutes: 15 });
  passkeyList.mockResolvedValue({ passkeys, twoStep });
  ssoIdentities.mockResolvedValue({ identities: [], available: [] });
}

const LAPTOP_KEY = {
  id: 'pk1',
  name: 'Chrome on macOS',
  createdAt: '2026-10-01T09:00:00Z',
  lastUsedAt: null,
  backedUp: true,
};

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

describe('passkeys', () => {
  it('adds one named after the device it was made on', async () => {
    serve();
    passkeyOptions.mockResolvedValue({ options: { challenge: 'abc' } });
    createPasskey.mockResolvedValue({ id: 'cred' });
    passkeyAdd.mockResolvedValue(LAPTOP_KEY);
    render(<SecuritySection onError={vi.fn()} isOwner={false} />);

    fireEvent.click(await screen.findByText('Add a passkey'));
    await waitFor(() => expect(passkeyAdd).toHaveBeenCalled());
    expect(createPasskey).toHaveBeenCalledWith({ challenge: 'abc' });
    const [credential, name] = passkeyAdd.mock.calls[0] as [unknown, string];
    expect(credential).toEqual({ id: 'cred' });
    expect(typeof name).toBe('string');
    // The list is asked for again, with the new one in it.
    await waitFor(() => expect(passkeyList).toHaveBeenCalledTimes(2));
  });

  it('says nothing when the person closes the browser’s prompt', async () => {
    serve();
    passkeyOptions.mockResolvedValue({ options: { challenge: 'abc' } });
    createPasskey.mockRejectedValue(new DOMException('closed', 'NotAllowedError'));
    const onError = vi.fn();
    render(<SecuritySection onError={onError} isOwner={false} />);

    fireEvent.click(await screen.findByText('Add a passkey'));
    await waitFor(() => expect(createPasskey).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText('Add a passkey').closest('button')?.disabled).toBe(false),
    );
    expect(onError).not.toHaveBeenCalledWith(expect.any(String));
    expect(passkeyAdd).not.toHaveBeenCalled();
  });

  it('removes one after asking, and tells the password manager', async () => {
    serve({ passkeys: [LAPTOP_KEY] });
    passkeyRemove.mockResolvedValue({ credentialId: 'cred-b64' });
    render(<SecuritySection onError={vi.fn()} isOwner={false} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Chrome on macOS' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(passkeyRemove).toHaveBeenCalledWith('pk1'));
    await waitFor(() => expect(forgetPasskey).toHaveBeenCalledWith('cred-b64'));
  });

  it('offers the second step only once there is a passkey to ask for', async () => {
    serve();
    const { unmount } = render(<SecuritySection onError={vi.fn()} isOwner={false} />);
    await screen.findByText(/None yet/);
    expect(screen.queryByLabelText('Ask for a passkey after my password')).toBeNull();
    unmount();

    serve({ passkeys: [LAPTOP_KEY], twoStep: false });
    setTwoStep.mockResolvedValue({ ok: true });
    render(<SecuritySection onError={vi.fn()} isOwner={false} />);
    const toggle = await screen.findByLabelText('Ask for a passkey after my password');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    await waitFor(() => expect(setTwoStep).toHaveBeenCalledWith(true));
  });
});

describe('the record, in words', () => {
  it('has a sentence for every kind of line', async () => {
    const { describeEvent } = await import('./devices.ts');
    const kinds = [
      'signed_in',
      'confirmed',
      'failed',
      'password_changed',
      'signed_out_elsewhere',
      'session_ended',
      'passkey_added',
      'passkey_removed',
      'two_step_on',
      'two_step_off',
    ] as const;
    for (const kind of kinds) expect(describeEvent({ kind, method: null })).toBeTruthy();
    expect(describeEvent({ kind: 'signed_in', method: 'two_step' })).toBe(
      'Signed in with a password and a passkey',
    );
  });
});

describe('single sign-on', () => {
  it('says nothing on a server with no providers', async () => {
    serve();
    render(<SecuritySection onError={vi.fn()} isOwner={false} />);
    await screen.findByText('Passkeys');
    await waitFor(() => expect(ssoIdentities).toHaveBeenCalled());
    expect(screen.queryByText('Single sign-on')).toBeNull();
  });

  it('lists what is linked, and links what is not', async () => {
    serve();
    ssoIdentities.mockResolvedValue({
      identities: [
        {
          providerId: 'p1',
          slug: 'acme',
          name: 'Acme',
          linkedAt: '2026-10-01T00:00:00Z',
          lastUsedAt: null,
        },
      ],
      available: [{ slug: 'globex', name: 'Globex' }],
    });
    ssoBegin.mockResolvedValue({ url: 'https://idp.example.com/authorize' });
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign, search: '' },
      configurable: true,
      writable: true,
    });
    render(<SecuritySection onError={vi.fn()} isOwner={false} />);

    expect(await screen.findByRole('button', { name: 'Unlink Acme' })).toBeTruthy();
    fireEvent.click(screen.getByText('Link Globex'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://idp.example.com/authorize'));
    expect(ssoBegin).toHaveBeenCalledWith({
      provider: 'globex',
      intent: 'link',
      next: '/settings/security',
    });
  });

  it('unlinks after asking', async () => {
    serve();
    ssoIdentities.mockResolvedValue({
      identities: [
        { providerId: 'p1', slug: 'acme', name: 'Acme', linkedAt: null, lastUsedAt: null },
      ],
      available: [],
    });
    ssoUnlink.mockResolvedValue({ ok: true });
    render(<SecuritySection onError={vi.fn()} isOwner={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Unlink Acme' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(ssoUnlink).toHaveBeenCalledWith('p1'));
  });
});
