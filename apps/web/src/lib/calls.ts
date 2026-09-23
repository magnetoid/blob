/** Being in a call: which one, how far the connection has got, where it is shown.
 *
 * The LiveKit connection itself lives in `features/calls/engine.ts`, imported the first
 * time somebody joins. LiveKit is most of a megabyte and the main chunk carries none of it
 * (the W2 ratchet), so everything here is plain state and plain functions: the header
 * button and the sidebar read it without pulling the engine in.
 *
 * Every way in is `startCall`; every way out is `leaveCall` or the room ending on its own.
 * Each join is a numbered attempt (`attempt`), bumped by every join and every ending, and
 * whatever an older attempt still has in flight — a token fetch, a `connect()`, a device
 * prompt — checks the number again when it lands and does nothing once it no longer
 * matches. `features/calls/engine.ts` applies the same rule to the rooms themselves.
 */

import { api, type Call, type CallKind } from './api.ts';
import { navigate, parseRoute, pathForRoute, type Route } from './router.ts';
import { useStore } from './store.ts';
import { showError, useToasts } from './toasts.ts';

export type CallPhase = 'connecting' | 'connected' | 'reconnecting';

export interface CallSession {
  callId: string;
  channelId: string;
  kind: CallKind;
  phase: CallPhase;
}

type Engine = typeof import('../features/calls/engine.ts');
let engine: Promise<Engine> | null = null;

/** The engine chunk would not load. Most of the time that is transient — a network blip,
 *  a slow connection — and forgetting it, below, is the right answer: browsers no longer
 *  cache a failed module fetch (whatwg/html#10327), so the next join is a real retry. It
 *  is not transient when a deploy has shipped since this page loaded: the chunk's URL is
 *  content-hashed, the old one is simply gone, and no amount of retrying fetches a file
 *  that no longer exists — only a reload (a fresh `index.html`, fresh chunk names) does.
 *  `joinCall` cannot tell those two apart, so it says the one thing true of both. */
class EngineUnavailable extends Error {
  constructor(cause: unknown) {
    super('Could not load the calls engine', { cause });
    this.name = 'EngineUnavailable';
  }
}

function loadEngine(): Promise<Engine> {
  engine ??= import('../features/calls/engine.ts')
    .then((module) => {
      useStore.setState({ callEngineLoaded: true });
      return module;
    })
    .catch((error: unknown) => {
      // Forgotten either way: right for a transient failure, and harmless for a deploy's
      // — see the class comment above for why retrying cannot itself fix that one.
      engine = null;
      throw new EngineUnavailable(error);
    });
  return engine;
}

export function callPath(callId: string): string {
  return pathForRoute({ view: 'call', callId });
}

/** Whether `/call/:id` should show full screen for *this* call — not merely that the
 *  route is a call route at all. `Workspace` used to read `route.view === 'call'` alone,
 *  so opening someone else's `/call/<id>` while already in your own call elsewhere read
 *  as full screen too: your own dock (gated on `!fullScreen`) dropped off screen, while
 *  `CallView` — keyed on the route's own callId — showed only a Join prompt for the call
 *  the link actually names. Connected, audible, and nothing of your call left on screen
 *  (R45). */
export function isFullScreenFor(route: Route, session: CallSession | null): boolean {
  return route.view === 'call' && route.callId === session?.callId;
}

/** Bumped by every join and every ending. An attempt still in flight checks it again
 *  after each await and does nothing once it no longer matches. */
let attempt = 0;
/** A start request is already out — a double click waits for it rather than racing it. */
let starting = false;

/** Who pressed the button that started the call in hand — on the same reasoning as a
 *  dialog's opener (`components/Dialog.tsx`): the control focus goes back to once the
 *  call ends, so a keyboard or screen-reader user is not left on `<body>`. */
let opener: HTMLElement | null = null;

/** Start a call of this kind in this conversation, or join the one that is live. */
export async function startCall(channelId: string, kind: CallKind): Promise<void> {
  if (starting) return;
  const { callSession } = useStore.getState();
  if (callSession?.channelId === channelId && callSession.kind === kind) {
    // Already in it: a meetup's button is the way back to its full screen.
    if (kind === 'meetup') navigate(callPath(callSession.callId));
    return;
  }
  if (callSession) {
    useStore.setState({ pendingCallSwitch: { channelId, kind } });
    return;
  }
  // Captured only now, for a start that is actually going to happen: any earlier and a
  // press that only opens the "leave this one?" question, or that no-ops because you are
  // already in the call, would overwrite the opener for the call you are *actually* in —
  // so cancelling the switch and later ending that call would throw focus at a button in
  // a conversation you never left.
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const before = attempt;
  starting = true;
  let call: Call;
  try {
    call = await api.calls.start(channelId, kind);
  } catch (err) {
    // A leave (sign-out is the real case) while the POST was out means this is not a
    // call to be in any more, or to complain about — the same rule the success path
    // below follows for the very same reason.
    if (before !== attempt) return;
    showError(err);
    return;
  } finally {
    starting = false;
  }
  // Fills a gap, never overwrites: a frame for this same call can already have arrived
  // while the POST was out — someone else's join broadcasting to a channel this client
  // is already in — and the POST's own answer is a snapshot from *before* that, so
  // applying it now would roll back whatever the frame already said (a participant list,
  // most concretely).
  if (!useStore.getState().activeCalls[call.id]) {
    useStore.getState().applyEvent({ t: 'call.started', call });
  }
  // Something already ended the attempt this would have joined — sign-out is the real
  // case — while the request was out. Not a call to be in any more.
  if (before !== attempt) return;
  await joinCall(call);
}

export async function confirmCallSwitch(): Promise<void> {
  const pending = useStore.getState().pendingCallSwitch;
  useStore.setState({ pendingCallSwitch: null });
  if (!pending) return;
  await leaveCall();
  await startCall(pending.channelId, pending.kind);
}

export function cancelCallSwitch(): void {
  useStore.setState({ pendingCallSwitch: null });
}

async function joinCall(call: Call): Promise<void> {
  attempt += 1;
  const mine = attempt;
  const isCurrent = () => mine === attempt;

  useStore.setState({
    callSession: { callId: call.id, channelId: call.channelId, kind: call.kind, phase: 'connecting' },
  });
  if (call.kind === 'meetup') navigate(callPath(call.id));
  const settings = useStore.getState().callSettings;
  try {
    const [{ connect }, pass] = await Promise.all([loadEngine(), api.calls.token(call.id)]);
    if (!isCurrent()) return;
    await connect(pass.url, pass.token, {
      camera: call.kind === 'meetup' && settings.meetups.camerasOnJoin,
      onPhase: (phase) => {
        if (isCurrent()) setPhase(phase);
      },
      onEnded: () => {
        if (isCurrent()) endSession();
      },
      onDeviceError: (device) => {
        if (!isCurrent()) return;
        useToasts
          .getState()
          .push(
            'info',
            device === 'microphone'
              ? 'Blob can’t use your microphone. Others can’t hear you until you allow it.'
              : 'Blob can’t use your camera.',
          );
      },
    });
    if (!isCurrent()) return; // the engine already refused to publish a stale room
  } catch (err) {
    if (!isCurrent()) return; // an attempt you already left shows no error
    endSession();
    if (err instanceof EngineUnavailable) {
      // Not the error's own message — see the class comment: it is never sure which of
      // the two causes this is, so it says the one thing true of both.
      useToasts.getState().push('error', 'Blob can’t load calls. Reload the page to try again.');
    } else {
      showError(err);
    }
  }
}

export async function leaveCall(): Promise<void> {
  endSession();
  // Never load a megabyte of LiveKit just to leave nothing: if nobody ever joined,
  // `engine` is still null and there is no room to disconnect.
  if (!engine) return;
  try {
    const { disconnect } = await engine;
    await disconnect();
  } catch {
    // A failed engine load means no room was ever made — nothing to leave.
  }
}

function setPhase(phase: CallPhase): void {
  const { callSession } = useStore.getState();
  if (!callSession || callSession.phase === phase) return;
  useStore.setState({ callSession: { ...callSession, phase } });
}

/** A call surface — the dock or the full-screen view — carries this, so the check below
 *  is one `closest()` rather than a list of selectors that has to be kept in sync with
 *  every place a call renders. */
const CALL_SURFACE_SELECTOR = '[data-call-surface]';

/** Where focus goes once a call ends: back to whoever started it, or the conversation's
 *  composer if the opener is gone, or — if neither survived — the page's own first
 *  landmark, so a keyboard or screen-reader user never lands on `<body>`. None of this
 *  runs if the person has since moved focus to something that has nothing to do with the
 *  call, which is left alone rather than yanked back.
 *
 *  Runs synchronously, right after the session clears in the store and before React's
 *  next render can apply `inert` to a leaving dock or unmount a full-screen view that
 *  still holds the focused element — either of which would otherwise blur focus to
 *  `<body>` with nothing to catch it. */
function returnFocus(): void {
  const target = opener;
  opener = null;
  const active = document.activeElement;
  const onCallSurface = active instanceof HTMLElement && active.closest(CALL_SURFACE_SELECTOR);
  if (active !== document.body && !onCallSurface) return; // moved on: leave it alone

  if (target?.isConnected) {
    target.focus();
    return;
  }
  const composer = document.querySelector<HTMLElement>('.composer-input');
  if (composer) {
    composer.focus();
    return;
  }
  // Last link: neither survived — a console has no composer, and full screen's own
  // conversation is not rendered while `view === 'call'`. The ordinary landmark-focus
  // pattern: a temporary tabindex lets an element that is not normally a tab stop take
  // focus once, and it comes off again the moment focus leaves, so it does not linger as
  // an unexpected extra stop for whoever tabs through afterwards.
  const main = document.querySelector<HTMLElement>('main');
  if (!main) return;
  main.setAttribute('tabindex', '-1');
  main.focus();
  main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true });
}

function endSession(): void {
  // The attempt in hand is over, however it ended — whatever it still has in flight (a
  // token fetch, a connect, a device prompt) is stale from here on.
  attempt += 1;
  const { callSession } = useStore.getState();
  if (!callSession) return;
  useStore.setState({ callSession: null });

  // Full screen of a call you are no longer in is a dead end; go back to its
  // conversation. `replace`, so Back does not return to the call page you just left.
  const route = parseRoute(window.location.pathname);
  const navigatingAway = route.view === 'call' && route.callId === callSession.callId;

  if (!navigatingAway) {
    // Nothing on this path is about to be replaced — hand focus over now, synchronously,
    // ahead of the `inert` React is about to apply to a leaving dock (R30's ordering).
    returnFocus();
    return;
  }

  navigate(pathForRoute({ view: 'channel', channelId: callSession.channelId }), { replace: true });
  // Deferred (R35): every link of `returnFocus`'s chain — the opener, the composer, the
  // `main` it would otherwise settle on — is `CallView`'s own DOM, which this navigation
  // is about to replace. Handing focus over now would evaluate the chain against a page
  // that no longer exists a moment later, landing on `<body>` regardless — the very
  // symptom R30 exists to remove. One frame is not enough: an update from a click
  // flushes at the end of its event, but one from the room ending on its own goes
  // through React's scheduler, and two frames clear both. Nothing on this path is
  // inert, so the delay costs nothing, and `returnFocus`'s own "moved on" check still
  // applies when it finally runs — a person who has since clicked into something during
  // those two frames keeps their focus rather than having it pulled back.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      returnFocus();
    });
  });
}
