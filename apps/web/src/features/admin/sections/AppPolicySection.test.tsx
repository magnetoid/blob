// @vitest-environment happy-dom
/**
 * The server's App policy page: what each workspace may do to this machine. The operator's
 * say, so a workspace admin never sees it. Pinned: every capability is a named switch with
 * its hint tied to it; one the whole server forbids is shown off, disabled, and says why;
 * the numbers save on blur and only when they changed; and choosing another workspace reads
 * that workspace's policy and not the last one's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api, type InstanceWorkspace, type WorkspacePolicy } from '../../../lib/api.ts';
import { AppPolicySection } from './AppPolicySection.tsx';

const workspace = (id: string, name: string): InstanceWorkspace => ({
  id,
  name,
  slug: id,
  memberCount: 3,
  channelCount: 2,
  appCount: 1,
  createdAt: '2026-10-01T09:00:00Z',
});

const POLICY: WorkspacePolicy = {
  workspaceId: 'w1',
  mayHostAgents: true,
  mayUsePrivateEndpoints: false,
  mayConnectSocketAgents: true,
  deniedScopes: [],
  maxApps: 5,
  agentChainMaxDepth: 2,
  serverAllowsHosting: true,
  serverAllowsPrivateEndpoints: true,
  serverChainMaxDepth: 4,
};

beforeEach(() => {
  vi.spyOn(api.admin, 'instanceWorkspaces').mockResolvedValue({
    workspaces: [workspace('w1', 'Acme'), workspace('w2', 'Globex')],
  });
  vi.spyOn(api.admin, 'workspacePolicy').mockImplementation(async (id: string) => ({
    ...POLICY,
    workspaceId: id,
    maxApps: id === 'w2' ? 9 : 5,
  }));
  vi.spyOn(api.admin, 'setWorkspacePolicy').mockResolvedValue(POLICY);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('what a workspace may do', () => {
  it('reads each capability as a switch with its hint tied to it', async () => {
    render(<AppPolicySection onError={vi.fn()} />);
    expect(
      await screen.findByRole('switch', {
        name: 'Deploy agents from a repository',
        checked: true,
        description: /The sharpest thing on this page/,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('switch', { name: 'Register an app on a private address', checked: false }),
    ).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Connect agents over a socket', checked: true })).toBeTruthy();
  });

  it('turns one on and off for the chosen workspace', async () => {
    render(<AppPolicySection onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Register an app on a private address' }));
    await waitFor(() =>
      expect(api.admin.setWorkspacePolicy).toHaveBeenCalledWith('w1', {
        mayUsePrivateEndpoints: true,
      }),
    );
  });

  it('shows a capability the whole server forbids as off and disabled, and says why', async () => {
    vi.spyOn(api.admin, 'workspacePolicy').mockResolvedValue({
      ...POLICY,
      serverAllowsHosting: false,
    });
    render(<AppPolicySection onError={vi.fn()} />);
    const hosting = await screen.findByRole('switch', {
      name: 'Deploy agents from a repository',
      // Written down as on, but it cannot take effect, so it is not drawn as on.
      checked: false,
      description: /Hosting is off for the whole server — set AGENT_RUNNER to turn it on/,
    });
    expect(hosting.hasAttribute('disabled') || hosting.getAttribute('aria-disabled') === 'true').toBe(
      true,
    );
    fireEvent.click(hosting);
    expect(api.admin.setWorkspacePolicy).not.toHaveBeenCalled();
  });
});

describe('the numbers', () => {
  it('saves the most apps on blur, empty meaning no limit', async () => {
    render(<AppPolicySection onError={vi.fn()} />);
    const apps = (await screen.findByRole('spinbutton', {
      name: 'Most apps it may install',
      description: /Leave empty for no limit/,
    })) as HTMLInputElement;
    expect(apps.value).toBe('5');

    fireEvent.change(apps, { target: { value: '' } });
    fireEvent.blur(apps);
    await waitFor(() =>
      expect(api.admin.setWorkspacePolicy).toHaveBeenCalledWith('w1', { maxApps: null }),
    );
  });

  it('saves nothing when a number is left as it was', async () => {
    render(<AppPolicySection onError={vi.fn()} />);
    const apps = await screen.findByRole('spinbutton', { name: 'Most apps it may install' });
    fireEvent.blur(apps);
    const hops = screen.getByRole('spinbutton', { name: 'Agent-to-agent hops' });
    fireEvent.blur(hops);
    expect(api.admin.setWorkspacePolicy).not.toHaveBeenCalled();
  });

  it('saves the hops, and refuses one that is not a whole number', async () => {
    render(<AppPolicySection onError={vi.fn()} />);
    const hops = await screen.findByRole('spinbutton', { name: 'Agent-to-agent hops' });

    fireEvent.change(hops, { target: { value: '-1' } });
    fireEvent.blur(hops);
    fireEvent.change(hops, { target: { value: '1.5' } });
    fireEvent.blur(hops);
    expect(api.admin.setWorkspacePolicy).not.toHaveBeenCalled();

    fireEvent.change(hops, { target: { value: '3' } });
    fireEvent.blur(hops);
    await waitFor(() =>
      expect(api.admin.setWorkspacePolicy).toHaveBeenCalledWith('w1', { agentChainMaxDepth: 3 }),
    );
  });

  it('is off, and says so, when the server allows no hops at all', async () => {
    vi.spyOn(api.admin, 'workspacePolicy').mockResolvedValue({ ...POLICY, serverChainMaxDepth: 0 });
    render(<AppPolicySection onError={vi.fn()} />);
    const hops = (await screen.findByRole('spinbutton', {
      name: 'Agent-to-agent hops',
      description: /Off for the whole server: AGENT_CHAIN_MAX_DEPTH is 0/,
    })) as HTMLInputElement;
    expect(hops.disabled).toBe(true);
  });
});

describe('the workspace', () => {
  it('opens on the first, and reads the policy of the one chosen next', async () => {
    render(<AppPolicySection onError={vi.fn()} />);
    const picker = (await screen.findByRole('combobox', { name: 'Workspace' })) as HTMLSelectElement;
    await waitFor(() => expect(picker.options.length).toBe(2));
    expect(picker.value).toBe('w1');
    expect(
      ((await screen.findByRole('spinbutton', { name: 'Most apps it may install' })) as HTMLInputElement).value,
    ).toBe('5');

    fireEvent.change(picker, { target: { value: 'w2' } });
    await waitFor(() => expect(api.admin.workspacePolicy).toHaveBeenCalledWith('w2'));
    // The number shown is the other workspace's, not left over from the first.
    await waitFor(() =>
      expect(
        (screen.getByRole('spinbutton', { name: 'Most apps it may install' }) as HTMLInputElement).value,
      ).toBe('9'),
    );
  });

  it('says a workspace admin cannot read any of this', async () => {
    render(<AppPolicySection onError={vi.fn()} />);
    expect(await screen.findByText(/A workspace admin cannot read or change any of this/)).toBeTruthy();
  });
});
