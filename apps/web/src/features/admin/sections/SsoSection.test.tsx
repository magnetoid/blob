// @vitest-environment happy-dom
/** The server administrator's single sign-on page (ADR 0033). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '../../../test/overlayChunk.ts';

const PROVIDER = {
  id: 'p1',
  slug: 'acme',
  name: 'Acme',
  issuer: 'https://idp.example.com',
  clientId: 'blob-client',
  scopes: 'openid email profile',
  allowedDomains: ['acme.example'],
  linkByEmail: true,
  joinWorkspaceId: 'w1',
  enabled: true,
  hasSecret: true,
  linked: 3,
};

const ssoProviders = vi.fn(async () => ({
  providers: [PROVIDER],
  callbackUrl: 'https://chat.example.com/api/auth/sso/callback',
}));
const instanceWorkspaces = vi.fn(async () => ({
  workspaces: [{ id: 'w1', name: 'Northwind', slug: 'northwind' }],
}));
const createSso = vi.fn<(input: unknown) => Promise<typeof PROVIDER>>(async () => PROVIDER);
const updateSso = vi.fn<(id: string, input: unknown) => Promise<typeof PROVIDER>>(async () => PROVIDER);
const deleteSso = vi.fn<(id: string) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
const checkSso = vi.fn<(id: string) => Promise<{ ok: boolean; message: string }>>(async () => ({
  ok: true,
  message: 'It answers.',
}));
vi.mock('../../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      admin: {
        ...actual.api.admin,
        ssoProviders,
        instanceWorkspaces,
        createSso,
        updateSso,
        deleteSso,
        checkSso,
      },
    },
  };
});

const { SsoSection } = await import('./SsoSection.tsx');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** The card a heading titles, so a field is found in the form it belongs to. */
function card(title: string) {
  return within(screen.getByRole('heading', { name: title }).closest('[data-slot="card"]')!);
}

describe('single sign-on, for the server’s administrator', () => {
  it('shows the address to register and what each provider does', async () => {
    render(<SsoSection onError={vi.fn()} isOwner />);
    const address = (await screen.findByRole('textbox', {
      name: 'Redirect address',
    })) as HTMLInputElement;
    expect(address.value).toBe('https://chat.example.com/api/auth/sso/callback');
    expect(address.readOnly).toBe(true);
    expect(screen.getByText(/3 people · addresses at acme.example/)).toBeTruthy();
    expect(screen.getByText(/secret set/)).toBeTruthy();
    expect(await screen.findByText('Join Northwind as members')).toBeTruthy();
  });

  it('connects a provider from the form, domains split', async () => {
    render(<SsoSection onError={vi.fn()} isOwner />);
    await screen.findByRole('heading', { name: 'Connect a provider' });
    const form = card('Connect a provider');
    fireEvent.change(form.getByRole('textbox', { name: 'Button name' }), {
      target: { value: 'Globex' },
    });
    fireEvent.change(form.getByRole('textbox', { name: 'Short name' }), {
      target: { value: 'globex' },
    });
    fireEvent.change(form.getByRole('textbox', { name: 'Issuer' }), {
      target: { value: 'https://login.globex.example' },
    });
    fireEvent.change(form.getByRole('textbox', { name: 'Client id' }), { target: { value: 'cid' } });
    fireEvent.change(form.getByLabelText('Client secret'), { target: { value: 'shh' } });
    fireEvent.change(form.getByRole('textbox', { name: 'Only these domains' }), {
      target: { value: 'globex.example, globex.co.uk' },
    });
    fireEvent.click(form.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(createSso).toHaveBeenCalled());
    expect(createSso).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'globex',
        name: 'Globex',
        issuer: 'https://login.globex.example',
        clientId: 'cid',
        clientSecret: 'shh',
        allowedDomains: ['globex.example', 'globex.co.uk'],
        linkByEmail: true,
        enabled: true,
        joinWorkspaceId: null,
      }),
    );
  });

  it('reads the two switches as checkboxes with their hints, and sends what they say', async () => {
    render(<SsoSection onError={vi.fn()} isOwner />);
    await screen.findByRole('heading', { name: 'Connect a provider' });
    const form = card('Connect a provider');
    const link = form.getByRole('checkbox', {
      name: 'Link existing accounts by verified address',
      checked: true,
      description: /Off, people link it themselves while signed in/,
    });
    expect(form.getByRole('checkbox', { name: 'On the sign-in page', checked: true })).toBeTruthy();

    fireEvent.click(link);
    expect(form.getByRole('checkbox', { name: /^Link existing accounts/, checked: false })).toBeTruthy();
    fireEvent.change(form.getByRole('textbox', { name: 'Button name' }), { target: { value: 'G' } });
    fireEvent.change(form.getByRole('textbox', { name: 'Short name' }), { target: { value: 'gg' } });
    fireEvent.change(form.getByRole('textbox', { name: 'Issuer' }), {
      target: { value: 'https://g.example' },
    });
    fireEvent.change(form.getByRole('textbox', { name: 'Client id' }), { target: { value: 'c' } });
    fireEvent.click(form.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(createSso).toHaveBeenCalled());
    expect(createSso).toHaveBeenCalledWith(expect.objectContaining({ linkByEmail: false, enabled: true }));
  });

  it('offers the workspaces new people may join, and names the default', async () => {
    render(<SsoSection onError={vi.fn()} isOwner />);
    await screen.findByRole('heading', { name: 'Connect a provider' });
    const choice = (await within(
      screen.getByRole('heading', { name: 'Connect a provider' }).closest('[data-slot="card"]')! as HTMLElement,
    ).findByRole('combobox', { name: 'New people' })) as HTMLSelectElement;
    await waitFor(() =>
      expect([...choice.options].map((o) => o.textContent)).toEqual([
        'Need an invitation',
        'Join Northwind',
      ]),
    );
    expect(choice.value).toBe('');
  });

  it('checks a provider on request, and says so in a status', async () => {
    render(<SsoSection onError={vi.fn()} isOwner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check Acme' }));
    const answer = await screen.findByText('It answers.');
    expect(answer.getAttribute('role')).toBe('status');
    expect(answer.className).not.toContain('text-destructive');
  });

  it('says what a failed check found, in the error colour', async () => {
    checkSso.mockResolvedValueOnce({ ok: false, message: 'The issuer did not answer.' });
    render(<SsoSection onError={vi.fn()} isOwner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check Acme' }));
    const answer = await screen.findByText('The issuer did not answer.');
    expect(answer.getAttribute('role')).toBe('status');
    expect(answer.className).toContain('text-destructive');
  });
});

describe('the client secret', () => {
  it('is a password field that is never filled in, and says whether one is kept', async () => {
    render(<SsoSection onError={vi.fn()} isOwner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Acme' }));
    const form = card('Edit Acme');
    const secret = form.getByLabelText('Client secret') as HTMLInputElement;

    // The server never returns it, so the page has nothing to show: the field is empty, the
    // placeholder says one is set, and the browser is asked not to offer one.
    expect(secret.type).toBe('password');
    expect(secret.value).toBe('');
    expect(secret.getAttribute('autocomplete')).toBe('off');
    expect(secret.placeholder).toBe('Set — leave blank to keep');
    expect(form.queryByRole('textbox', { name: 'Client secret' })).toBeNull();

    // Saved untouched, no secret goes: the server keeps the one it has.
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateSso).toHaveBeenCalled());
    expect(updateSso.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ clientSecret: undefined, clientId: 'blob-client' }),
    );
  });

  it('is sent when typed, and is gone from the page once the provider is connected', async () => {
    render(<SsoSection onError={vi.fn()} isOwner />);
    await screen.findByRole('heading', { name: 'Connect a provider' });
    const form = card('Connect a provider');
    const secret = form.getByLabelText('Client secret') as HTMLInputElement;
    fireEvent.change(form.getByRole('textbox', { name: 'Button name' }), { target: { value: 'Globex' } });
    fireEvent.change(form.getByRole('textbox', { name: 'Short name' }), { target: { value: 'globex' } });
    fireEvent.change(form.getByRole('textbox', { name: 'Issuer' }), {
      target: { value: 'https://login.globex.example' },
    });
    fireEvent.change(form.getByRole('textbox', { name: 'Client id' }), { target: { value: 'cid' } });
    fireEvent.change(secret, { target: { value: 'hunter2-hunter2' } });
    expect(secret.value).toBe('hunter2-hunter2');

    fireEvent.click(form.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(createSso).toHaveBeenCalled());
    expect(createSso.mock.calls[0]![0]).toEqual(expect.objectContaining({ clientSecret: 'hunter2-hunter2' }));

    // Cleared as it is sent, not left in the field for the next provider.
    await waitFor(() => expect((form.getByLabelText('Client secret') as HTMLInputElement).value).toBe(''));
    expect(document.body.textContent).not.toContain('hunter2-hunter2');
    expect(
      [...document.querySelectorAll('[title], [aria-label], [placeholder]')].some((node) =>
        ['title', 'aria-label', 'placeholder'].some((a) =>
          node.getAttribute(a)?.includes('hunter2-hunter2'),
        ),
      ),
    ).toBe(false);
  });
});

describe('removing a provider', () => {
  it('asks first, and removes it on the answer', async () => {
    render(<SsoSection onError={vi.fn()} isOwner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Acme' }));
    expect(deleteSso).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Acme?' });
    expect(dialog.textContent).toContain('3 people sign in with it');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(deleteSso).toHaveBeenCalledWith('p1'));
  });

  // The confirm is the project's ConfirmDialog (an alert dialog on the Escape stack), not an
  // inline two-press: one Escape has to close it and nothing under it.
  it('closes only the confirm on Escape and returns focus to the button that opened it', async () => {
    // Stands in for the shell's own shortcuts, which listen on `window`.
    const shellHeard = vi.fn();
    const onWindowKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') shellHeard();
    };
    window.addEventListener('keydown', onWindowKey);
    try {
      render(<SsoSection onError={vi.fn()} isOwner />);
      const remove = await screen.findByRole('button', { name: 'Remove Acme' });
      // Something typed in the form under the dialog: Escape must not take it with it.
      fireEvent.change(card('Connect a provider').getByRole('textbox', { name: 'Button name' }), {
        target: { value: 'Half typed' },
      });
      // Pressed with focus on it, as a keyboard press (or a click in Chrome and Firefox) has:
      // the dialog remembers what had focus as it opened, and hands it back.
      remove.focus();
      fireEvent.click(remove);
      const dialog = await screen.findByRole('alertdialog', { name: 'Remove Acme?' });
      await waitFor(() => expect(document.activeElement).toBe(dialog));

      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(document.activeElement).toBe(remove);
      // One Escape, one layer: nothing was removed, nothing behind the dialog heard the key,
      // and the page and what was typed on it are still there.
      expect(deleteSso).not.toHaveBeenCalled();
      expect(shellHeard).not.toHaveBeenCalled();
      expect(screen.getByRole('heading', { name: 'Acme' })).toBeTruthy();
      expect(
        (card('Connect a provider').getByRole('textbox', { name: 'Button name' }) as HTMLInputElement).value,
      ).toBe('Half typed');
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
  });
});
