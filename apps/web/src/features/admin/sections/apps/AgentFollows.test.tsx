// @vitest-environment happy-dom
/**
 * The follow switches: one per channel the agent is in, saying what is followed now,
 * and sending the change the admin made.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentFollows } from './AgentFollows.tsx';
import { api } from '../../../../lib/api.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CHANNELS = [
  { id: 'c1', name: 'general', kind: 'public', joined: true },
  { id: 'c2', name: 'launch', kind: 'public', joined: true },
  { id: 'c3', name: 'random', kind: 'public', joined: false },
];

const act = async (run: () => Promise<unknown>) => {
  await run();
};

describe('the channels an agent follows', () => {
  it('offers only channels it is in, and shows which it follows', async () => {
    vi.spyOn(api.admin, 'agentFollows').mockResolvedValue({
      channels: [{ id: 'c2', name: 'launch', kind: 'public', since: '2026-10-19T00:00:00Z', hears: 'everything', quietMinutes: null }],
    });
    render(<AgentFollows pluginId="p1" agentName="Helper" channels={CHANNELS} act={act} />);

    const launch = await screen.findByRole('button', { name: 'Helper follows #launch' });
    await waitFor(() => expect(launch.getAttribute('aria-pressed')).toBe('true'));
    const general = screen.getByRole('button', { name: 'Helper follows #general' });
    expect(general.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Helper follows #random' })).toBeNull();
    expect(screen.getByText(/not only what mentions it/)).toBeTruthy();
  });

  it('follows and unfollows with the switch, and shows what the server says', async () => {
    vi.spyOn(api.admin, 'agentFollows').mockResolvedValue({ channels: [] });
    const follow = vi.spyOn(api.admin, 'followChannel').mockResolvedValue({
      channels: [{ id: 'c1', name: 'general', kind: 'public', since: '2026-10-19T00:00:00Z', hears: 'everything', quietMinutes: null }],
    });
    const unfollow = vi.spyOn(api.admin, 'unfollowChannel').mockResolvedValue({ channels: [] });
    render(<AgentFollows pluginId="p1" agentName="Helper" channels={CHANNELS} act={act} />);

    const general = await screen.findByRole('button', { name: 'Helper follows #general' });
    await waitFor(() => expect((general as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(general);
    await waitFor(() => expect(general.getAttribute('aria-pressed')).toBe('true'));
    expect(follow).toHaveBeenCalledWith('p1', 'c1');

    fireEvent.click(general);
    await waitFor(() => expect(general.getAttribute('aria-pressed')).toBe('false'));
    expect(unfollow).toHaveBeenCalledWith('p1', 'c1');
  });

  it('chooses what it hears in a channel it follows, and shows what the server says', async () => {
    vi.spyOn(api.admin, 'agentFollows').mockResolvedValue({
      channels: [
        { id: 'c2', name: 'launch', kind: 'public', since: '2026-10-19T00:00:00Z', hears: 'everything', quietMinutes: null },
      ],
    });
    const follow = vi.spyOn(api.admin, 'followChannel').mockResolvedValue({
      channels: [
        { id: 'c2', name: 'launch', kind: 'public', since: '2026-10-19T00:00:00Z', hears: 'unanswered', quietMinutes: 240 },
      ],
    });
    render(<AgentFollows pluginId="p1" agentName="Helper" channels={CHANNELS} act={act} />);

    const choice = await screen.findByLabelText<HTMLSelectElement>('What Helper hears in #launch');
    expect(choice.value).toBe('everything');
    // Only a followed channel has anything to choose.
    expect(screen.queryByLabelText('What Helper hears in #general')).toBeNull();

    fireEvent.change(choice, { target: { value: 'unanswered:240' } });
    await waitFor(() => expect(choice.value).toBe('unanswered:240'));
    expect(follow).toHaveBeenCalledWith('p1', 'c2', { hears: 'unanswered', quietMinutes: 240 });
  });

  it('says to add it to a channel first when it is in none', async () => {
    vi.spyOn(api.admin, 'agentFollows').mockResolvedValue({ channels: [] });
    render(
      <AgentFollows
        pluginId="p1"
        agentName="Helper"
        channels={CHANNELS.map((c) => ({ ...c, joined: false }))}
        act={act}
      />,
    );
    expect(await screen.findByText('It is in no channel yet. Add it to one above first.')).toBeTruthy();
  });
});
