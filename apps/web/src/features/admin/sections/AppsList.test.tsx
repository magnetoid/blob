// @vitest-environment happy-dom
/** The agents console, as Meadow 2c draws it.
 *
 * It was three install forms above a column of cards. What these pin: the numbers add
 * up, each agent is one row that says where it may act, the way in is one button whose
 * first choice is Janus, and no card is rendered here any more — per-app controls live
 * on the app's own page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const plugins = vi.fn();
const activity = vi.fn();
const workspacePolicy = vi.fn();

vi.mock('../../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      admin: {
        ...actual.api.admin,
        pluginCatalog: vi.fn(async () => ({ scopes: { 'messages:write': 'Post' }, events: {} })),
        plugins,
        settings: vi.fn(async () => ({ settings: { agentsEnabled: true } })),
        activity,
        workspacePolicy,
      },
    },
  };
});

const { AppsSection } = await import('./AppsSection.tsx');
const { useStore } = await import('../../../lib/store.ts');

const plugin = (over: Record<string, unknown>) => ({
  id: 'p1',
  slug: 'scout',
  name: 'Scout',
  description: 'Research & analytics',
  runtime: 'socket',
  status: 'enabled',
  version: '1.0.0',
  requestUrl: null,
  aguiUrl: null,
  events: [],
  scopes: ['messages:read'],
  pendingScopes: [],
  botUserId: 'b1',
  ownerUserId: null,
  lastError: null,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  pendingDeliveries: 0,
  failedDeliveries: 0,
  online: true,
  budgetRunsPerDay: null,
  budgetSecondsPerDay: null,
  runsLastDay: 2,
  secondsLastDay: 30,
  runsLastWeek: 11,
  runningNow: 1,
  channelCount: 6,
  ...over,
});

beforeEach(() => {
  plugins.mockReset();
  activity.mockReset();
  workspacePolicy.mockReset();
  plugins.mockResolvedValue({
    plugins: [
      plugin({}),
      plugin({
        id: 'p2',
        slug: 'janus',
        name: 'Janus',
        description: 'Janus, running beside Blob',
        runtime: 'external',
        scopes: ['messages:read', 'messages:write'],
        online: null,
        runsLastWeek: 30,
        runningNow: 0,
        channelCount: 4,
      }),
    ],
  });
  activity.mockResolvedValue({
    days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-0${i + 1}`, runs: i })),
  });
  workspacePolicy.mockResolvedValue({ agentChainMaxDepth: 3, agentReads: 'audience' });
  useStore.setState({ workspaceId: 'w1', users: {} } as never);
});
afterEach(cleanup);

describe('the agents console', () => {
  it('adds the numbers up in one line', async () => {
    render(<AppsSection onError={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/2 installed · 1 running now · 41 runs this week/)).toBeTruthy(),
    );
  });

  it('is one row per agent, saying where it may act, and no card', async () => {
    const { container } = render(<AppsSection onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Scout')).toBeTruthy());
    expect(screen.getByText('6 channels · read-only')).toBeTruthy();
    expect(screen.getByText('4 channels')).toBeTruthy();
    expect(screen.getByLabelText('1 running now')).toBeTruthy();
    expect(container.querySelector('.admin-plugin-card')).toBeNull();
    expect(container.querySelectorAll('table.admin-agents tbody tr')).toHaveLength(2);
  });

  it('shows the guardrails honestly — two live, one not yet', async () => {
    render(<AppsSection onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/max 3 hops/)).toBeTruthy());
    expect(screen.getByText(/the room it answers in/)).toBeTruthy();
    expect(screen.getByText(/not yet available/)).toBeTruthy();
  });

  it('still stands when the policy is not the admin’s to read', async () => {
    workspacePolicy.mockRejectedValue(new Error('403'));
    render(<AppsSection onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Scout')).toBeTruthy());
    expect(screen.getByText(/asker's permissions/)).toBeTruthy();
    expect(screen.queryByText(/hops/)).toBeNull();
  });

  it('has one way in, and Janus is the first choice', async () => {
    render(<AppsSection onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Scout')).toBeTruthy());
    expect(screen.queryByText(/Deploy an agent from a repository/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ Install agent' }));
    const dialog = screen.getByRole('dialog', { name: 'Install an agent' });
    const choices = dialog.querySelectorAll('.chip');
    expect(choices[0]?.textContent).toBe('Janus');
    expect(choices[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(dialog.textContent).toContain('no bridge');
  });

  it('draws a bar for every day of the week', async () => {
    const { container } = render(<AppsSection onError={vi.fn()} />);
    await waitFor(() => expect(container.querySelectorAll('.admin-chart-bar')).toHaveLength(7));
  });
});
