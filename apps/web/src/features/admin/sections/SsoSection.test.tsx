// @vitest-environment happy-dom
/** The server administrator's single sign-on page (ADR 0033). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

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
const createSso = vi.fn(async () => PROVIDER);
const checkSso = vi.fn(async () => ({ ok: true, message: 'It answers.' }));
vi.mock('../../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      admin: { ...actual.api.admin, ssoProviders, instanceWorkspaces, createSso, checkSso },
    },
  };
});

const { SsoSection } = await import('./SsoSection.tsx');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('single sign-on, for the server’s administrator', () => {
  it('shows the address to register and what each provider does', async () => {
    render(<SsoSection onError={vi.fn()} isOwner />);
    expect(await screen.findByText('https://chat.example.com/api/auth/sso/callback')).toBeTruthy();
    expect(screen.getByText(/3 people · addresses at acme.example/)).toBeTruthy();
    expect(screen.getByText(/secret set/)).toBeTruthy();
    expect(await screen.findByText('Join Northwind as members')).toBeTruthy();
  });

  it('connects a provider from the form, domains split', async () => {
    render(<SsoSection onError={vi.fn()} isOwner />);
    await screen.findByText('Connect a provider');
    const field = (label: string) => screen.getAllByLabelText(label).at(-1) as HTMLInputElement;
    fireEvent.change(field('Button name'), { target: { value: 'Globex' } });
    fireEvent.change(field('Short name'), { target: { value: 'globex' } });
    fireEvent.change(field('Issuer'), { target: { value: 'https://login.globex.example' } });
    fireEvent.change(field('Client id'), { target: { value: 'cid' } });
    fireEvent.change(field('Client secret'), { target: { value: 'shh' } });
    fireEvent.change(field('Only these domains'), {
      target: { value: 'globex.example, globex.co.uk' },
    });
    fireEvent.click(screen.getByText('Connect'));

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

  it('checks a provider on request', async () => {
    render(<SsoSection onError={vi.fn()} isOwner />);
    fireEvent.click(await screen.findByText('Check'));
    expect(await screen.findByText('It answers.')).toBeTruthy();
  });
});
