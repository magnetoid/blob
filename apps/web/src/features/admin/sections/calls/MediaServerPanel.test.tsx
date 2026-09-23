// @vitest-environment happy-dom
/** R45: the status line interpolated `latencyMs`/`error` straight into the sentence, so
 * whichever one LiveKit had not reported showed up as the literal word "null" —
 * "Answering in null ms", "Not answering — null". Branches on the null instead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mediaServer = vi.fn();
vi.mock('../../../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/api.ts')>();
  return { ...actual, api: { ...actual.api, admin: { ...actual.api.admin, mediaServer } } };
});

const { useStore } = await import('../../../../lib/store.ts');
const { MediaServerPanel } = await import('./MediaServerPanel.tsx');

afterEach(cleanup);
beforeEach(() => {
  mediaServer.mockReset();
  useStore.setState({ callsAvailable: true });
});

describe('MediaServerPanel prints no raw null (R45)', () => {
  it('says "Answering" with no unit when LiveKit reported no latency', async () => {
    mediaServer.mockResolvedValue({
      configured: true, url: 'wss://lk.example.com', reachable: true, latencyMs: null,
      error: null, openRooms: 0, lastEventAt: null,
      webhookUrl: 'https://chat.example.com/api/calls/livekit',
    });
    render(<MediaServerPanel isOwner onError={vi.fn()} />);
    expect(await screen.findByText('Answering')).toBeTruthy();
    expect(screen.queryByText(/null/)).toBeNull();
  });

  it('says "Not answering" with no trailing dash when LiveKit gave no reason', async () => {
    mediaServer.mockResolvedValue({
      configured: true, url: 'wss://lk.example.com', reachable: false, latencyMs: null,
      error: null, openRooms: null, lastEventAt: null,
      webhookUrl: 'https://chat.example.com/api/calls/livekit',
    });
    render(<MediaServerPanel isOwner onError={vi.fn()} />);
    expect(await screen.findByText('Not answering')).toBeTruthy();
    expect(screen.queryByText(/null/)).toBeNull();
  });

  it('still shows the latency when LiveKit does report one', async () => {
    mediaServer.mockResolvedValue({
      configured: true, url: 'wss://lk.example.com', reachable: true, latencyMs: 12,
      error: null, openRooms: 2, lastEventAt: null,
      webhookUrl: 'https://chat.example.com/api/calls/livekit',
    });
    render(<MediaServerPanel isOwner onError={vi.fn()} />);
    expect(await screen.findByText('Answering in 12 ms')).toBeTruthy();
  });

  it('still shows the reason when LiveKit does give one', async () => {
    mediaServer.mockResolvedValue({
      configured: true, url: 'wss://lk.example.com', reachable: false, latencyMs: null,
      error: 'timed out', openRooms: null, lastEventAt: null,
      webhookUrl: 'https://chat.example.com/api/calls/livekit',
    });
    render(<MediaServerPanel isOwner onError={vi.fn()} />);
    expect(await screen.findByText('Not answering — timed out')).toBeTruthy();
  });
});
