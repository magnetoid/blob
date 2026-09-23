// @vitest-environment happy-dom
/** Where focus goes when a call ends (R30): back to whoever started it, unless the
 * person has since moved it to something that has nothing to do with the call, which is
 * left alone. `startCall` remembers the opener; every exit runs through `endSession`,
 * which hands focus back — or does not — on the same reasoning as a dialog's opener
 * (`components/Dialog.tsx`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Call } from './api.ts';

const start = vi.fn();
const token = vi.fn();
vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>();
  return { ...actual, api: { ...actual.api, calls: { ...actual.api.calls, start, token } } };
});
const navigate = vi.fn();
vi.mock('./router.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./router.ts')>();
  return { ...actual, navigate };
});
const connect = vi.fn();
const disconnect = vi.fn();
vi.mock('../features/calls/engine.ts', () => ({ connect, disconnect }));
const showError = vi.fn();
const push = vi.fn();
vi.mock('./toasts.ts', () => ({ showError, useToasts: { getState: () => ({ push }) } }));

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

function button(): HTMLButtonElement {
  const el = document.createElement('button');
  document.body.appendChild(el);
  return el;
}

function composer(): HTMLTextAreaElement {
  const el = document.createElement('textarea');
  el.className = 'composer-input';
  document.body.appendChild(el);
  return el;
}

function twoFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ callSession: null, pendingCallSwitch: null, activeCalls: {} });
  token.mockResolvedValue({ token: 'jwt', url: 'wss://lk' });
  connect.mockImplementation(
    async (_url: string, _tok: string, options: { onPhase: (phase: string) => void }) => {
      options.onPhase('connected');
    },
  );
  // Most tests here assume the non-navigating path (R35 branches on the route), so the
  // one test that puts this on `/call/:id` must not leak it into the next.
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('focus, on the way out of a call (R30)', () => {
  it('leaving with focus on a call surface moves focus back to the button that started the call', async () => {
    const opener = button();
    opener.focus();
    start.mockResolvedValue(call());
    await calls.startCall('ch-1', 'huddle');

    const leaveBtn = button();
    leaveBtn.setAttribute('data-call-surface', 'true');
    leaveBtn.focus();
    expect(document.activeElement).toBe(leaveBtn);

    await calls.leaveCall();
    expect(document.activeElement).toBe(opener);
  });

  it('the room ending on its own, with focus already on <body>, still gets a home', async () => {
    const opener = button();
    opener.focus();
    start.mockResolvedValue(call());
    await calls.startCall('ch-1', 'huddle');
    const { onEnded } = connect.mock.calls[0]![2] as { onEnded: () => void };

    opener.blur();
    expect(document.activeElement).toBe(document.body);

    onEnded();
    expect(document.activeElement).toBe(opener);
  });

  it('leaving after the person has clicked into the composer does not move focus', async () => {
    const opener = button();
    opener.focus();
    start.mockResolvedValue(call());
    await calls.startCall('ch-1', 'huddle');

    const box = composer();
    box.focus();
    expect(document.activeElement).toBe(box);

    await calls.leaveCall();
    expect(document.activeElement).toBe(box);
  });

  it('an opener that is gone by the time the call ends falls back to the composer without throwing', async () => {
    const opener = button();
    opener.focus();
    start.mockResolvedValue(call());
    await calls.startCall('ch-1', 'huddle');
    opener.remove(); // gone: whatever panel it was in has since closed

    const box = composer();
    const surface = document.createElement('div');
    surface.tabIndex = -1;
    surface.setAttribute('data-call-surface', 'true');
    document.body.appendChild(surface);
    surface.focus();

    await expect(calls.leaveCall()).resolves.toBeUndefined();
    expect(document.activeElement).toBe(box);
  });

  it('pressing a second call’s button and cancelling the switch does not move the opener for the call you are still in', async () => {
    // Reproduces the small thing round 2 found: capturing the opener ahead of the
    // `starting`/already-in-it/`pendingCallSwitch` returns let a press that only opens
    // the "leave this one?" question overwrite the opener for the call actually in hand.
    const openerA = button();
    openerA.focus();
    start.mockResolvedValue(call());
    await calls.startCall('ch-1', 'huddle'); // call A begins

    const openerB = button();
    openerB.focus();
    await calls.startCall('ch-2', 'huddle'); // only asks — call A is still live
    expect(useStore.getState().pendingCallSwitch).toEqual({ channelId: 'ch-2', kind: 'huddle' });

    calls.cancelCallSwitch();

    const leaveBtn = button();
    leaveBtn.setAttribute('data-call-surface', 'true');
    leaveBtn.focus();

    await calls.leaveCall(); // ends call A — not the switch that never happened
    expect(document.activeElement).toBe(openerA);
  });

  it('already in the requested call: pressing its own button again does not move the opener either', async () => {
    // The "already in it" return is just as early as the switch question, and just as
    // capable of overwriting the opener for no reason — a meetup's button is the way
    // back to full screen, not a new join, and does not restart who owns the opener.
    const openerA = button();
    openerA.focus();
    start.mockResolvedValue(call({ kind: 'meetup' }));
    await calls.startCall('ch-1', 'meetup');

    const pressedAgain = button();
    pressedAgain.focus();
    await calls.startCall('ch-1', 'meetup'); // already in it: navigates, nothing more
    expect(navigate).toHaveBeenCalledWith('/call/call-1');

    const leaveBtn = button();
    leaveBtn.setAttribute('data-call-surface', 'true');
    leaveBtn.focus();

    await calls.leaveCall();
    expect(document.activeElement).toBe(openerA);
  });
});

describe('focus, the last link in the chain (R33)', () => {
  it('leaving from a console, where there is no composer, lands on the page’s own main landmark', async () => {
    const opener = button();
    opener.focus();
    start.mockResolvedValue(call());
    await calls.startCall('ch-1', 'huddle');
    opener.remove(); // the console the floating dock sat over has since changed section

    // The floating dock's own Leave button — a call surface, no composer anywhere near.
    const dock = document.createElement('div');
    dock.setAttribute('data-call-surface', 'true');
    document.body.appendChild(dock);
    const leaveBtn = document.createElement('button');
    dock.appendChild(leaveBtn);
    leaveBtn.focus();

    const main = document.createElement('main');
    main.className = 'admin-main';
    document.body.appendChild(main);

    await calls.leaveCall();
    expect(document.activeElement).toBe(main);
    expect(main.getAttribute('tabindex')).toBe('-1');
  });

  it('the temporary tabindex comes off once focus moves on, so it does not linger as an extra tab stop', async () => {
    const opener = button();
    opener.focus();
    start.mockResolvedValue(call());
    await calls.startCall('ch-1', 'huddle');
    opener.remove(); // nothing else focused afterwards: focus reverts to <body>
    expect(document.activeElement).toBe(document.body);

    const main = document.createElement('main');
    document.body.appendChild(main);

    await calls.leaveCall();
    expect(document.activeElement).toBe(main);
    expect(main.hasAttribute('tabindex')).toBe(true);

    const elsewhere = button();
    elsewhere.focus();
    expect(main.hasAttribute('tabindex')).toBe(false);
  });

  it('no main on the page at all: falls back without throwing', async () => {
    const opener = button();
    opener.focus();
    start.mockResolvedValue(call());
    await calls.startCall('ch-1', 'huddle');
    opener.remove();
    expect(document.activeElement).toBe(document.body);

    await expect(calls.leaveCall()).resolves.toBeUndefined();
  });
});

describe('focus timing depends on whether this ends in a navigation (R35)', () => {
  it('leaving from the bar (no navigation) still moves focus synchronously, within the same tick', async () => {
    const opener = button();
    opener.focus();
    start.mockResolvedValue(call());
    await calls.startCall('ch-1', 'huddle');

    const leaveBtn = button();
    leaveBtn.setAttribute('data-call-surface', 'true');
    leaveBtn.focus();

    const leaving = calls.leaveCall(); // not yet awaited
    // Already moved: this runs before `leaveCall`'s own `await` even starts, so nothing
    // between here and there could have handed focus over except `endSession` itself.
    expect(document.activeElement).toBe(opener);

    await leaving;
    expect(document.activeElement).toBe(opener);
  });

  it('leaving from full screen defers: focus has not moved by the time endSession returns', async () => {
    const opener = button();
    opener.focus();
    start.mockResolvedValue(call());
    await calls.startCall('ch-1', 'huddle');
    window.history.replaceState(null, '', '/call/call-1'); // full screen, this call
    opener.remove(); // the conversation that held it is not rendered here

    const callViewMain = document.createElement('main');
    callViewMain.setAttribute('data-call-surface', 'true');
    document.body.appendChild(callViewMain);
    const leaveBtn = document.createElement('button');
    callViewMain.appendChild(leaveBtn);
    leaveBtn.focus();

    const leaving = calls.leaveCall();
    expect(navigate).toHaveBeenCalledWith('/c/ch-1', { replace: true });
    // Not yet — the render this navigation leads to has not "happened" in this test,
    // and nothing here has a chance to move focus until it does.
    expect(document.activeElement).toBe(leaveBtn);

    await leaving;
    expect(document.activeElement).toBe(leaveBtn); // still not — leaveCall's own await
    // (the engine's disconnect) is unrelated to the two animation frames R35 waits for.
  });

  it('leaving from full screen: once the navigation’s own render has settled, two frames later, focus lands on the conversation’s composer', async () => {
    const opener = button();
    opener.focus();
    start.mockResolvedValue(call());
    await calls.startCall('ch-1', 'huddle');
    window.history.replaceState(null, '', '/call/call-1');
    opener.remove();

    const callViewMain = document.createElement('main');
    callViewMain.setAttribute('data-call-surface', 'true');
    document.body.appendChild(callViewMain);
    const leaveBtn = document.createElement('button');
    callViewMain.appendChild(leaveBtn);
    leaveBtn.focus();

    const leaving = calls.leaveCall();

    // The navigation's own render, simulated: CallView's DOM is gone, replaced by the
    // conversation's — composer included, the way `endSession`'s `navigate` really
    // leads there a render later.
    callViewMain.remove();
    const box = composer();

    await leaving;
    await twoFrames();

    expect(document.activeElement).toBe(box);
  });

  it('the "moved on" check still applies once the two frames pass: clicking elsewhere during them keeps focus there', async () => {
    const opener = button();
    opener.focus();
    start.mockResolvedValue(call());
    await calls.startCall('ch-1', 'huddle');
    window.history.replaceState(null, '', '/call/call-1');
    opener.remove();

    const callViewMain = document.createElement('main');
    callViewMain.setAttribute('data-call-surface', 'true');
    document.body.appendChild(callViewMain);
    const leaveBtn = document.createElement('button');
    callViewMain.appendChild(leaveBtn);
    leaveBtn.focus();

    const leaving = calls.leaveCall();
    callViewMain.remove();
    composer(); // on screen, but not where the person actually goes

    const elsewhere = button();
    elsewhere.focus(); // clicked into something else entirely, before the frames pass

    await leaving;
    await twoFrames();

    expect(document.activeElement).toBe(elsewhere); // left alone, not pulled back
  });
});
