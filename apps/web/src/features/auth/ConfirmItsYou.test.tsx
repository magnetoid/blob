// @vitest-environment happy-dom
/** The prompt the server's `reauth_required` brings up (M3 · B1). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const reauthState = vi.fn();
const reauth = vi.fn();
const confirmOptions = vi.fn();
const confirm = vi.fn();
vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      auth: { ...actual.api.auth, reauthState, reauth },
      passkeys: { ...actual.api.passkeys, confirmOptions, confirm },
    },
  };
});

const getPasskey = vi.fn();
vi.mock('../../lib/passkeys.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/passkeys.ts')>();
  return {
    ...actual,
    passkeysSupported: () => true,
    getPasskey: (...args: unknown[]) => getPasskey(...args),
  };
});

const { ConfirmItsYou } = await import('./ConfirmItsYou.tsx');
const { confirmItsYou } = await import('../../lib/stepUp.ts');
const { ApiError } = await import('../../lib/api.ts');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function ask(): Promise<boolean> {
  let answer!: Promise<boolean>;
  act(() => {
    answer = confirmItsYou();
  });
  return answer;
}

describe('confirming it is you', () => {
  it('asks for the password and answers yes once the server accepts it', async () => {
    reauthState.mockResolvedValue({ methods: ['password'], provenAt: null, windowMinutes: 15 });
    reauth.mockResolvedValue({ ok: true });
    render(<ConfirmItsYou />);

    const answer = ask();
    await screen.findByText('Confirm it’s you', { selector: 'h2' });
    await screen.findByText(/You won’t be asked again for 15 minutes/);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
    fireEvent.click(screen.getByText('Confirm'));

    expect(await answer).toBe(true);
    expect(reauth).toHaveBeenCalledWith('correct-horse');
  });

  it('keeps asking after a wrong password, and says why', async () => {
    reauthState.mockResolvedValue({ methods: ['password'], provenAt: null, windowMinutes: 15 });
    reauth.mockRejectedValueOnce(
      new ApiError(400, 'wrong_password', 'That password is incorrect.', 'password'),
    );
    render(<ConfirmItsYou />);

    void ask();
    await screen.findByText('Confirm it’s you', { selector: 'h2' });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByText('Confirm'));

    expect(await screen.findByText('That password is incorrect.')).toBeTruthy();
    expect(screen.getByText('Confirm', { selector: 'button' })).toBeTruthy();
  });

  it('answers no when cancelled, without checking anything', async () => {
    reauthState.mockResolvedValue({ methods: ['password'], provenAt: null, windowMinutes: 15 });
    render(<ConfirmItsYou />);

    const answer = ask();
    await screen.findByText('Confirm it’s you', { selector: 'h2' });
    fireEvent.click(screen.getByText('Cancel'));

    expect(await answer).toBe(false);
    expect(reauth).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText('Confirm it’s you', { selector: 'h2' })).toBeNull(),
    );
  });

  it('answers no if it goes away mid-question, and asks afresh next time', async () => {
    reauthState.mockResolvedValue({ methods: ['password'], provenAt: null, windowMinutes: 15 });
    const first = render(<ConfirmItsYou />);
    const abandoned = ask();
    await screen.findByText('Confirm it’s you', { selector: 'h2' });
    first.unmount();
    expect(await abandoned).toBe(false);

    render(<ConfirmItsYou />);
    void ask();
    expect(await screen.findByText('Confirm it’s you', { selector: 'h2' })).toBeTruthy();
  });

  it('takes a passkey instead of the password', async () => {
    reauthState.mockResolvedValue({
      methods: ['password', 'passkey'],
      provenAt: null,
      windowMinutes: 15,
    });
    confirmOptions.mockResolvedValue({ flowId: 'flow-1234567890', options: { challenge: 'x' } });
    getPasskey.mockResolvedValue({ id: 'cred' });
    confirm.mockResolvedValue({ ok: true });
    render(<ConfirmItsYou />);

    const answer = ask();
    fireEvent.click(await screen.findByText('Use a passkey'));
    expect(await answer).toBe(true);
    expect(confirm).toHaveBeenCalledWith('flow-1234567890', { id: 'cred' });
    expect(reauth).not.toHaveBeenCalled();
  });

  it('makes the passkey the way when there is no password', async () => {
    reauthState.mockResolvedValue({ methods: ['passkey'], provenAt: null, windowMinutes: 15 });
    render(<ConfirmItsYou />);
    void ask();
    const button = await screen.findByText('Use a passkey');
    expect(button.className).toContain('btn-primary');
    expect(screen.queryByLabelText('Password')).toBeNull();
  });
});
