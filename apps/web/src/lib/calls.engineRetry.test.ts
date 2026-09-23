// @vitest-environment happy-dom
/** `loadEngine()`'s own failure path, isolated from `calls.race.test.ts`: a transient
 * failure — a network blip, a slow connection — must not be cached forever, or every
 * join fails until somebody reloads; forgetting it is right for that case, since browsers
 * no longer cache a failed module fetch (whatwg/html#10327) and the next import is a real
 * retry. This is deliberately *not* a stand-in for the other cause the same rejection can
 * have — a deploy that has already removed the content-hashed chunk this promise was
 * built against — because retrying an `import()` can never fix that one; only a reload
 * can. `calls.ts`'s own comment on `loadEngine` says so, and `joinCall`'s toast for this
 * error says the one thing true of both rather than claiming either. A dynamic `import()`
 * that genuinely rejects is not something the other call tests need, so it gets its own
 * small file and its own mock of `features/calls/engine.ts` rather than the fake
 * `livekit-client` the others share.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Call } from './api.ts';

const start = vi.fn();
const token = vi.fn();
vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>();
  return { ...actual, api: { ...actual.api, calls: { ...actual.api.calls, start, token } } };
});
vi.mock('./router.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./router.ts')>();
  return { ...actual, navigate: vi.fn() };
});
const showError = vi.fn();
const push = vi.fn();
vi.mock('./toasts.ts', () => ({ showError, useToasts: { getState: () => ({ push }) } }));

// vi.mock factories are hoisted above ordinary module-scope `let`/`const`, so the
// mutable counter has to be `vi.hoisted()` to still be there when the factory runs.
const engineImport = vi.hoisted(() => ({ attempts: 0 }));
const connect = vi.fn();
const disconnect = vi.fn();
vi.mock('../features/calls/engine.ts', () => {
  engineImport.attempts += 1;
  // The first import — the one every test here starts from — fails the way a network
  // blip does: transient, nothing about the chunk itself gone.
  if (engineImport.attempts === 1) throw new Error('fetch failed');
  return { connect, disconnect };
});

const { useStore } = await import('./store.ts');
const calls = await import('./calls.ts');

const call = (over: Partial<Call> = {}): Call => ({
  id: 'call-1',
  channelId: 'ch-1',
  kind: 'huddle',
  createdBy: 'u1',
  status: 'active',
  createdAt: '2026-09-22T10:00:00.000Z',
  endedAt: null,
  participantIds: [],
  ...over,
});

beforeEach(() => {
  useStore.setState({ callSession: null, pendingCallSwitch: null, activeCalls: {} });
  start.mockResolvedValue(call());
  token.mockResolvedValue({ token: 'jwt', url: 'wss://lk' });
  connect.mockResolvedValue(undefined);
});

describe('a failed engine import', () => {
  it("shows its own toast — not the failure's own message, which could mean either cause — and is retried on the next join", async () => {
    // The first join fails during the import itself, before there is anything to
    // connect. `joinCall` cannot tell a network blip from a deploy that has already
    // removed this chunk, so it shows neither underlying error's own message.
    await calls.startCall('ch-1', 'huddle');
    expect(showError).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('error', 'Blob can’t load calls. Reload the page to try again.');
    expect(useStore.getState().callSession).toBeNull();
    expect(connect).not.toHaveBeenCalled();
    expect(engineImport.attempts).toBe(1);

    // The second join is a fresh attempt: forgetting the failure was right here, since
    // this one was transient — the import runs the real module code and the join goes
    // through. (A deploy's removed chunk would fail exactly the same way a second time;
    // this file is about the retry mechanics, not about telling the two causes apart —
    // nothing in `calls.ts` can.)
    await calls.startCall('ch-1', 'huddle');
    expect(engineImport.attempts).toBe(2);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(useStore.getState().callSession?.callId).toBe('call-1');
  });
});
