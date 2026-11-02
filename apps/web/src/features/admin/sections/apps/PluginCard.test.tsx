// @vitest-environment happy-dom
/** One installed app's controls: what it is, what an update asks for, its budget and
 * credentials, and what has happened to it lately.
 *
 * What these pin is the part somebody acts on. An update that asks for more is a decision
 * with both answers on screen and the words of what is asked; the credentials buttons say
 * what they hand back and where a failure goes; and the activity — runs, then deliveries —
 * opens a row at a time, with the payload of a delivery readable and its replay one press
 * away only where it can help.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  api,
  ApiError,
  type AdminAgentRun,
  type AdminPlugin,
  type AdminPluginDelivery,
  type AdminPluginDeliveryDetail,
} from '../../../../lib/api.ts';
import { useStore } from '../../../../lib/store.ts';
import { Card } from '../../../console/Card.tsx';
import { PluginCard } from './PluginCard.tsx';

const PLUGIN = {
  id: 'p1',
  slug: 'scout',
  name: 'Scout',
  description: 'Research & analytics',
  runtime: 'external',
  status: 'enabled',
  version: '1.2.0',
  requestUrl: 'https://apps.example.com/hook',
  aguiUrl: null,
  events: ['message.created'],
  scopes: ['messages:read', 'messages:write'],
  pendingScopes: [] as string[],
  botUserId: 'b1',
  ownerUserId: null as string | null,
  lastError: null,
  recentErrors: [],
  secretRotatedAt: null,
  tokenLastUsedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  pendingDeliveries: 0,
  failedDeliveries: 0,
  online: null,
  budgetRunsPerDay: null,
  budgetSecondsPerDay: null,
  budgetTokensPerDay: null,
  runsLastDay: 0,
  secondsLastDay: 0,
  tokensLastDay: 0,
} as unknown as AdminPlugin;

const delivery = (over: Partial<AdminPluginDelivery> = {}): AdminPluginDelivery => ({
  id: 'd1',
  event: 'message.created',
  status: 'delivered',
  attempts: 1,
  lastStatusCode: 200,
  lastError: null,
  createdAt: '2026-10-07T10:00:00.000Z',
  deliveredAt: '2026-10-07T10:00:01.000Z',
  ...over,
});

const act = async (run: () => Promise<unknown>) => {
  await run();
};

function show(
  over: Partial<AdminPlugin> = {},
  props: Partial<React.ComponentProps<typeof PluginCard>> = {},
) {
  const handlers = {
    onError: vi.fn(),
    onSecret: vi.fn(),
    onToggleDelivery: vi.fn(),
    onReplay: vi.fn(),
    onUninstall: vi.fn(),
  };
  render(
    <Card title="Budget, credentials and activity">
      <PluginCard
        plugin={{ ...PLUGIN, ...over }}
        scopeCatalog={{ 'messages:read': 'Read messages', 'messages:write': 'Post messages' }}
        runs={[]}
        deliveries={[]}
        expandedDeliveryId={null}
        deliveryDetails={{}}
        act={act}
        {...handlers}
        {...props}
      />
    </Card>,
  );
  return handlers;
}

beforeEach(() => {
  useStore.setState({ users: { u2: { id: 'u2', displayName: 'Ana', kind: 'human' } } } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('what the app is', () => {
  it('names it and says its state, version, where it listens and what it hears and may do', () => {
    show({ version: '1.2.0' });
    expect(screen.getByText('Scout')).toBeTruthy();
    expect(screen.getByText('enabled')).toBeTruthy();
    expect(screen.getByText('v1.2.0')).toBeTruthy();
    expect(
      screen.getByText('Research & analytics · https://apps.example.com/hook · bot user b1'),
    ).toBeTruthy();
    expect(screen.getByText('message.created')).toBeTruthy();
    expect(screen.getByText('messages:read')).toBeTruthy();
    expect(screen.getByText('messages:write')).toBeTruthy();
  });

  it('says an agent that dials in is connected or not, and an app that does not says nothing', () => {
    show({ online: false });
    expect(screen.getByText('not connected')).toBeTruthy();
    cleanup();
    show({ online: true });
    expect(screen.getByText('connected')).toBeTruthy();
    cleanup();
    show({ online: null });
    expect(screen.queryByText('connected')).toBeNull();
    expect(screen.queryByText('not connected')).toBeNull();
  });

  it('says whose it is when it is somebody’s, and what is waiting or has failed', () => {
    show({ ownerUserId: 'u2', pendingDeliveries: 3, failedDeliveries: 2 });
    expect(screen.getByText('Ana’s')).toBeTruthy();
    expect(screen.getByText('3 pending')).toBeTruthy();
    expect(screen.getByText('2 failed')).toBeTruthy();
  });

  it('marks a permission an update asked for and nobody has approved', () => {
    show({ status: 'needs_review', pendingScopes: ['messages:write'] });
    // The scope is also named in the decision above, so it is the badge that is looked for.
    const badge = (scope: string) =>
      screen.getAllByText(scope).find((element) => element.getAttribute('data-slot') === 'badge');
    expect(badge('messages:write')?.getAttribute('title')).toBe(
      'Requested by an update, not yet approved',
    );
    expect(badge('messages:read')?.getAttribute('title')).toBe('Read messages');
  });

  it('says when its secret was rotated and whether its token is in use', () => {
    show({ secretRotatedAt: null, tokenLastUsedAt: null });
    expect(screen.getByText('Signing secret rotated never · no bot token used yet')).toBeTruthy();
  });

  it('puts the last failure in words, under the rest', () => {
    show({ lastError: 'Circuit open' });
    expect(screen.getByText('Circuit open')).toBeTruthy();
  });
});

describe('an update that asks for more', () => {
  const NEEDS_REVIEW = { status: 'needs_review', pendingScopes: ['messages:write'] } as Partial<AdminPlugin>;

  it('lists what it asks for in words, with both answers', async () => {
    const approve = vi.spyOn(api.admin, 'approvePlugin').mockResolvedValue({} as never);
    const decline = vi.spyOn(api.admin, 'declinePluginScopes').mockResolvedValue({} as never);
    show(NEEDS_REVIEW);

    const group = screen.getByRole('group', { name: 'This update asks for new permissions' });
    expect(within(group).getByText('messages:write')).toBeTruthy();
    expect(within(group).getByText(/Post messages/)).toBeTruthy();

    fireEvent.click(within(group).getByRole('button', { name: 'Keep current permissions' }));
    await waitFor(() => expect(decline).toHaveBeenCalledWith('p1'));
    fireEvent.click(within(group).getByRole('button', { name: 'Approve new permissions' }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith('p1'));
  });

  it('has a plain Approve when it was parked with nothing itemised', async () => {
    const approve = vi.spyOn(api.admin, 'approvePlugin').mockResolvedValue({} as never);
    show({ status: 'needs_review', pendingScopes: [] });
    expect(screen.queryByRole('group', { name: 'This update asks for new permissions' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith('p1'));
  });

  it('does not ask for a decision when there is none to make', () => {
    show();
    expect(screen.queryByRole('group', { name: 'This update asks for new permissions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
});

describe('the buttons that act on the app', () => {
  it('turns it off, or on', async () => {
    const set = vi.spyOn(api.admin, 'setPluginEnabled').mockResolvedValue({} as never);
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(set).toHaveBeenCalledWith('p1', false));
    cleanup();
    show({ status: 'disabled' });
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(set).toHaveBeenLastCalledWith('p1', true));
  });

  it('hands back a rotated secret, once, to whoever shows it', async () => {
    vi.spyOn(api.admin, 'rotatePluginSecret').mockResolvedValue({ signingSecret: 'whsec_new' } as never);
    const { onSecret, onError } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));
    await waitFor(() =>
      expect(onSecret).toHaveBeenCalledWith({ pluginName: 'Scout', signingSecret: 'whsec_new' }),
    );
    expect(onError).toHaveBeenCalledWith(null);
  });

  it('hands back an issued token, once', async () => {
    vi.spyOn(api.admin, 'issuePluginToken').mockResolvedValue({ botToken: 'bot_new' } as never);
    const { onSecret } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));
    await waitFor(() => expect(onSecret).toHaveBeenCalledWith({ pluginName: 'Scout', botToken: 'bot_new' }));
  });

  it('says why when it could not, and hands back nothing', async () => {
    vi.spyOn(api.admin, 'rotatePluginSecret').mockRejectedValue(
      new ApiError(403, 'forbidden', 'Not yours to rotate.'),
    );
    vi.spyOn(api.admin, 'issuePluginToken').mockRejectedValue(new Error('down'));
    const { onSecret, onError } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Not yours to rotate.'));
    fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not issue a bot token.'));
    expect(onSecret).not.toHaveBeenCalled();
  });

  it('revokes its tokens', async () => {
    const revoke = vi.spyOn(api.admin, 'revokePluginTokens').mockResolvedValue({} as never);
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke tokens' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('p1'));
  });

  it('asks to uninstall, and leaves the asking to its caller', () => {
    const { onUninstall } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }));
    expect(onUninstall).toHaveBeenCalledTimes(1);
  });
});

describe('what has happened to it', () => {
  const RUN = {
    id: 'r1',
    channelId: 'c1',
    channelName: 'general',
    threadRootId: null,
    triggerMessageId: 'm1',
    triggerUserName: 'Ana',
    transport: 'http',
    status: 'succeeded',
    error: null,
    postCount: 1,
    startedAt: '2026-10-07T10:00:00.000Z',
    finishedAt: '2026-10-07T10:00:03.000Z',
    durationMs: 3000,
    depth: 0,
    askedBy: null,
    tokens: null,
    card: null,
    seen: null,
  } as AdminAgentRun;

  it('lists its recent runs, and says when there are none', () => {
    show({}, { runs: [RUN] });
    expect(screen.getByRole('heading', { name: 'Recent runs' })).toBeTruthy();
    expect(screen.getByText('#general')).toBeTruthy();
    cleanup();
    show();
    expect(screen.getByText('This app has not been asked anything yet.')).toBeTruthy();
  });

  it('lists its deliveries, and says when there are none', () => {
    show(
      {},
      {
        deliveries: [
          delivery(),
          delivery({ id: 'd2', status: 'failed', attempts: 5, lastStatusCode: 500, lastError: 'boom' }),
        ],
      },
    );
    expect(screen.getByRole('heading', { name: 'Deliveries' })).toBeTruthy();
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[1]!).getByText('failed')).toBeTruthy();
    expect(within(rows[1]!).getByText(/5 attempts · created .* · HTTP 500 · boom/)).toBeTruthy();
    cleanup();
    show();
    expect(screen.getByText('No delivery attempts recorded yet.')).toBeTruthy();
  });

  it('opens a delivery onto its payload, naming the delivery the button is for', () => {
    const { onToggleDelivery } = show(
      {},
      {
        deliveries: [delivery()],
        expandedDeliveryId: 'd1',
        deliveryDetails: {
          d1: {
            ...delivery(),
            nextAttemptAt: null,
            payload: { text: 'hello' },
          } as AdminPluginDeliveryDetail,
        },
      },
    );
    const toggle = screen.getByRole('button', { name: 'Details message.created' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/"text": "hello"/)).toBeTruthy();
    // Only a delivery that did not get through can be sent again.
    expect(screen.queryByRole('button', { name: 'Replay' })).toBeNull();
    fireEvent.click(toggle);
    expect(onToggleDelivery).toHaveBeenCalledWith('d1');
  });

  it('keeps a closed delivery closed, and says it is loading one that has not arrived', () => {
    show({}, { deliveries: [delivery()] });
    const toggle = screen.getByRole('button', { name: 'Details message.created' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBeNull();
    cleanup();
    show({}, { deliveries: [delivery()], expandedDeliveryId: 'd1' });
    expect(screen.getByText('Loading delivery…')).toBeTruthy();
  });

  it('offers to send a failed delivery again', () => {
    const { onReplay } = show(
      {},
      {
        deliveries: [delivery({ status: 'dead' })],
        expandedDeliveryId: 'd1',
        deliveryDetails: {
          d1: { ...delivery({ status: 'dead' }), nextAttemptAt: null, payload: {} } as AdminPluginDeliveryDetail,
        },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    expect(onReplay).toHaveBeenCalledWith('d1');
  });

  it('keeps a conversation you are not in to itself', () => {
    show(
      {},
      {
        deliveries: [delivery()],
        expandedDeliveryId: 'd1',
        deliveryDetails: {
          d1: { ...delivery(), nextAttemptAt: null, payload: null, hidden: true } as AdminPluginDeliveryDetail,
        },
      },
    );
    expect(screen.getByText(/From a conversation you are not in/)).toBeTruthy();
  });
});
