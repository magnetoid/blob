// @vitest-environment happy-dom
/** Drafts arriving from your other devices never overwrite what this tab is typing, and
 *  this tab's own saves coming back are not news (ADR 0037). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./socket.ts', () => ({
  socket: {
    send: vi.fn(),
    sendControl: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
    disconnect: vi.fn(),
    onEvent: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    onStatus: vi.fn(() => vi.fn()),
  },
}));

const pending = new Set<string>();
vi.mock('./draftSync.ts', () => ({
  DEVICE_ID: 'this-tab',
  connectDraftSync: vi.fn(),
  scheduleDraftSync: vi.fn((key: string) => pending.add(key)),
  hasPendingDraftSync: (key: string) => pending.has(key),
  cancelDraftSyncs: vi.fn(),
  flushDraftSyncs: vi.fn(),
}));

const { useStore } = await import('./store.ts');

const remote = (body: string, device: string | null = 'the-phone') =>
  ({
    t: 'draft.updated',
    channelId: 'c1',
    threadRootId: null,
    body,
    updatedAt: '2026-10-21T09:00:00.000Z',
    device,
  }) as never;

beforeEach(() => {
  pending.clear();
  useStore.setState({ drafts: {} } as never);
});

describe('a draft from another device', () => {
  it('arrives', () => {
    useStore.getState().applyEvent(remote('from the phone'));
    expect(useStore.getState().drafts.c1?.body).toBe('from the phone');
  });

  it('never replaces what this tab is typing', () => {
    useStore.getState().setDraft('c1', null, 'typing here');
    useStore.getState().applyEvent(remote('from the phone'));
    expect(useStore.getState().drafts.c1?.body).toBe('typing here');
  });

  it('is not this tab’s own save coming back', () => {
    useStore.setState({ drafts: { c1: { body: 'typed past it', updatedAt: 'x' } } } as never);
    useStore.getState().applyEvent(remote('typed', 'this-tab'));
    expect(useStore.getState().drafts.c1?.body).toBe('typed past it');
  });

  it('goes when it was sent from somewhere else', () => {
    useStore.setState({ drafts: { c1: { body: 'about to send', updatedAt: 'x' } } } as never);
    useStore.getState().applyEvent(remote('', null));
    expect(useStore.getState().drafts.c1).toBeUndefined();
  });
});
