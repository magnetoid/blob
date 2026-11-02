// @vitest-environment happy-dom
/** Whether a hosted agent is running, and the five things to do about it.
 *
 * The panels are disclosures — configuration, a terminal, the logs — and each says whether
 * it is open. The terminal is the one part that is not drawn from the console's kit, so it
 * sits in a legacy island, and what is checked here is that it is there and only on request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api, ApiError } from '../../../../lib/api.ts';
import { AgentDeployment } from './AgentDeployment.tsx';

// xterm.js is imported lazily by the real terminal; this is the part the page owns.
vi.mock('../../../agentic/AgentTerminal.tsx', () => ({
  AgentTerminal: ({ agentName, onClose }: { agentName: string; onClose: () => void }) => (
    <div>
      terminal in {agentName}
      <button onClick={onClose}>Close terminal</button>
    </div>
  ),
}));
vi.mock('./AgentConfig.tsx', () => ({
  AgentConfig: () => <div>the configuration</div>,
}));

const DEPLOYED = { deploymentId: 'dep1', status: 'running', url: null };

beforeEach(() => {
  vi.spyOn(api.admin, 'deployment').mockResolvedValue(DEPLOYED);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function show(props: Partial<React.ComponentProps<typeof AgentDeployment>> = {}) {
  const onError = vi.fn();
  render(
    <AgentDeployment
      pluginId="p1"
      agentName="Helper"
      repo="https://github.com/acme/helper"
      gitRef="main"
      onError={onError}
      {...props}
    />,
  );
  return { onError };
}

describe('the deployment', () => {
  it('says it is checking, then what state it is in and where it came from', async () => {
    show({ gitRef: 'next' });
    expect(screen.getByText('checking…')).toBeTruthy();
    expect(await screen.findByText('running')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'acme/helper@next' });
    expect(link.getAttribute('href')).toBe('https://github.com/acme/helper');
  });

  it('leaves the branch out when it is main', async () => {
    show();
    await screen.findByText('running');
    expect(screen.getByRole('link', { name: 'acme/helper' })).toBeTruthy();
  });

  it('says so when the runner cannot be reached', async () => {
    vi.spyOn(api.admin, 'deployment').mockRejectedValue(new Error('down'));
    const { onError } = show();
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not reach the runner.'));
  });
});

describe('the panels', () => {
  it('open one at a time, each button keeping its name and saying whether it is open', async () => {
    show();
    await screen.findByText('running');
    const config = screen.getByRole('button', { name: 'Config' });
    const terminal = screen.getByRole('button', { name: 'Terminal' });
    expect(config.getAttribute('aria-expanded')).toBe('false');
    expect(terminal.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('the configuration')).toBeNull();

    fireEvent.click(config);
    expect(config.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('the configuration')).toBeTruthy();

    fireEvent.click(terminal);
    expect(config.getAttribute('aria-expanded')).toBe('false');
    expect(terminal.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByText('the configuration')).toBeNull();
    expect(screen.getByText('terminal in Helper')).toBeTruthy();

    fireEvent.click(terminal);
    expect(screen.queryByText('terminal in Helper')).toBeNull();
  });

  it('points each button at its panel while the panel is there, and at nothing otherwise', async () => {
    vi.spyOn(api.admin, 'deploymentLogs').mockResolvedValue({ logs: 'booted in 2s' });
    show();
    await screen.findByText('running');
    const panelOf = (button: HTMLElement) => {
      const id = button.getAttribute('aria-controls');
      return id ? document.getElementById(id) : null;
    };
    const config = screen.getByRole('button', { name: 'Config' });
    const terminal = screen.getByRole('button', { name: 'Terminal' });
    const logs = screen.getByRole('button', { name: 'Logs' });
    for (const button of [config, terminal, logs]) expect(button.getAttribute('aria-controls')).toBeNull();

    fireEvent.click(config);
    expect(panelOf(config)?.textContent).toBe('the configuration');
    expect(terminal.getAttribute('aria-controls')).toBeNull();

    fireEvent.click(terminal);
    expect(config.getAttribute('aria-controls')).toBeNull();
    expect(panelOf(terminal)?.textContent).toContain('terminal in Helper');

    fireEvent.click(logs);
    await screen.findByText('booted in 2s');
    expect(panelOf(logs)?.textContent).toBe('booted in 2s');
    // Both open at once, each to its own.
    expect(panelOf(terminal)).not.toBe(panelOf(logs));

    fireEvent.click(logs);
    expect(logs.getAttribute('aria-controls')).toBeNull();
  });

  it('draws the terminal in a legacy island, and puts it away from its own close', async () => {
    show();
    await screen.findByText('running');
    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }));
    expect(screen.getByText('terminal in Helper').closest('[data-legacy]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }));
    expect(screen.queryByText('terminal in Helper')).toBeNull();
    expect(screen.getByRole('button', { name: 'Terminal' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('reads the logs on request, and puts them away', async () => {
    vi.spyOn(api.admin, 'deploymentLogs').mockResolvedValue({ logs: 'booted in 2s' });
    show();
    await screen.findByText('running');
    const logs = screen.getByRole('button', { name: 'Logs' });
    fireEvent.click(logs);
    expect(await screen.findByText('booted in 2s')).toBeTruthy();
    expect(logs.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(logs);
    expect(screen.queryByText('booted in 2s')).toBeNull();
    expect(logs.getAttribute('aria-expanded')).toBe('false');
  });

  it('says so when there is nothing logged', async () => {
    vi.spyOn(api.admin, 'deploymentLogs').mockResolvedValue({ logs: '' });
    show();
    await screen.findByText('running');
    fireEvent.click(screen.getByRole('button', { name: 'Logs' }));
    expect(await screen.findByText('Nothing logged yet.')).toBeTruthy();
  });
});

describe('redeploying and stopping', () => {
  it('redeploys, then asks again what state it is in', async () => {
    const redeploy = vi.spyOn(api.admin, 'redeploy').mockResolvedValue(DEPLOYED);
    show();
    await screen.findByText('running');
    const before = vi.mocked(api.admin.deployment).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Redeploy' }));
    await waitFor(() => expect(redeploy).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(vi.mocked(api.admin.deployment).mock.calls.length).toBe(before + 1));
  });

  it('stops it', async () => {
    const stop = vi.spyOn(api.admin, 'stopAgent').mockResolvedValue(DEPLOYED as never);
    show();
    await screen.findByText('running');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(stop).toHaveBeenCalledWith('p1'));
  });

  it('says why when it could not', async () => {
    vi.spyOn(api.admin, 'redeploy').mockRejectedValue(new ApiError(502, 'runner_down', 'The runner is down.'));
    const { onError } = show();
    await screen.findByText('running');
    fireEvent.click(screen.getByRole('button', { name: 'Redeploy' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('The runner is down.'));
  });

  it('asks again on Refresh', async () => {
    show();
    await screen.findByText('running');
    const before = vi.mocked(api.admin.deployment).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(vi.mocked(api.admin.deployment).mock.calls.length).toBe(before + 1));
  });
});
