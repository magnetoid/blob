/** The question an assistant's sign-in comes down to (ADR 0029): may this app act as you?
 *
 * An assistant — Claude, ChatGPT, anything that speaks MCP — sends the browser here with
 * its request in the query string. The server checks it; this page asks; either answer
 * sends the browser back to the app, with a code or with a no.
 *
 * Before anybody says yes the page has to make three things plain, because they are how a
 * look-alike is told from the real thing: what the app calls itself, which website stands
 * behind that name — or that nothing does — and where the answer goes, said loudly when
 * it is a program on this computer rather than a website. Posting is a second tick, off
 * unless ticked: the app asked for it, the person decides.
 */

import { useEffect, useState } from 'react';
import { api, ApiError, type OAuthConsentRequest } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { useFetch } from '../../lib/useFetch.ts';
import { hostOf, leave } from './consent.ts';

type State =
  | { kind: 'checking' }
  | { kind: 'asking'; request: OAuthConsentRequest }
  | { kind: 'leaving'; to: string }
  | { kind: 'refused'; message: string };

function messageOf(err: unknown): string {
  return err instanceof ApiError
    ? err.message
    : 'The request could not be checked. Try again from the app.';
}

export function ConsentScreen() {
  const me = useStore((s) => s.currentUser);
  const workspace = useStore((s) => s.workspaceName);
  const checked = useFetch(() => api.oauth.authorize(window.location.search), []);
  // What happened once the person answered — it outranks whatever the check said.
  const [after, setAfter] = useState<State | null>(null);
  const [write, setWrite] = useState(false);
  const [busy, setBusy] = useState(false);

  // A request that was wrong in a way the app can be told about goes straight back to it.
  const straightBack = checked.data?.redirectTo ?? null;
  useEffect(() => {
    if (straightBack) leave.to(straightBack);
  }, [straightBack]);

  const state: State =
    after ??
    (checked.error
      ? { kind: 'refused', message: messageOf(checked.error) }
      : straightBack
        ? { kind: 'leaving', to: straightBack }
        : checked.data?.request
          ? { kind: 'asking', request: checked.data.request }
          : { kind: 'checking' });

  async function answer(approve: boolean) {
    if (state.kind !== 'asking' || busy) return;
    setBusy(true);
    try {
      const { redirectTo } = await api.oauth.decide(state.request.id, approve, approve && write);
      setAfter({ kind: 'leaving', to: redirectTo });
      leave.to(redirectTo);
    } catch (err) {
      setBusy(false);
      setAfter({ kind: 'refused', message: messageOf(err) });
    }
  }

  async function switchAccount() {
    // Signed out, the same address shows the sign-in screen, and the question comes back
    // once whoever signs in is in.
    await api.auth.logout().catch(() => undefined);
    window.location.reload();
  }

  return (
    <div className="auth consent">
      <main className="auth-card consent-card" aria-busy={state.kind === 'checking'}>
        {state.kind === 'checking' && <p className="muted m-0">Checking the request…</p>}

        {state.kind === 'refused' && (
          <>
            <div>
              <div className="auth-mark" aria-hidden="true">
                B
              </div>
              <h1 className="auth-title consent-title">This connection can’t go ahead</h1>
              <p className="auth-subtitle">{state.message}</p>
            </div>
            <a className="btn btn-ghost consent-home" href="/">
              Go to {workspace || 'Blob'}
            </a>
          </>
        )}

        {state.kind === 'leaving' && (
          <div>
            <h1 className="auth-title">Sending you back</h1>
            <p className="auth-subtitle">
              To {hostOf(state.to)}. If nothing happens, <a href={state.to}>continue</a>.
            </p>
          </div>
        )}

        {state.kind === 'asking' && (
          <Question
            request={state.request}
            workspace={workspace || 'Blob'}
            name={me?.displayName ?? null}
            write={write}
            busy={busy}
            onWrite={setWrite}
            onAnswer={(approve) => void answer(approve)}
            onSwitch={() => void switchAccount()}
          />
        )}
      </main>
    </div>
  );
}

function Question({
  request,
  workspace,
  name,
  write,
  busy,
  onWrite,
  onAnswer,
  onSwitch,
}: {
  request: OAuthConsentRequest;
  workspace: string;
  name: string | null;
  write: boolean;
  busy: boolean;
  onWrite: (write: boolean) => void;
  onAnswer: (approve: boolean) => void;
  onSwitch: () => void;
}) {
  const wantsWrite = request.scopes.includes('write');
  const initial = request.clientName.trim().charAt(0).toUpperCase() || '?';

  return (
    <>
      <div className="consent-marks" aria-hidden="true">
        <span className="auth-mark">B</span>
        <span className="consent-tie" />
        <span className="consent-app">{initial}</span>
      </div>
      <div>
        <h1 className="auth-title">
          Connect {request.clientName} to {workspace}?
        </h1>
        <p className="auth-subtitle">
          It will act as you{name ? `, ${name}` : ''}. It can read every channel and
          conversation you can
          {wantsWrite ? ', and post if you tick the box below.' : ', and cannot post.'}
        </p>
      </div>

      <ul className="consent-facts">
        {request.vouchedBy ? (
          <li data-tone="ok">
            <strong>{request.vouchedBy}</strong> confirms this is its app.
          </li>
        ) : (
          <li data-tone="warn">
            Nothing confirms this app’s name — it registered itself. Connect it only if you
            started this from the app you meant to.
          </li>
        )}
        {request.local ? (
          <li data-tone="warn">
            Your answer goes to <strong>a program on this computer</strong> (
            {request.redirectHost}). Connect only if you just started it yourself — Claude
            Code in a terminal, say.
          </li>
        ) : (
          <li>
            Your answer goes to <strong>{request.redirectHost}</strong>.
          </li>
        )}
      </ul>

      {wantsWrite && (
        <label className="pref-row consent-write">
          <span className="pref-label grow">
            Also let it post as you
            <span className="pref-hint block">
              A message it sends looks exactly like one you typed.
            </span>
          </span>
          <input
            type="checkbox"
            checked={write}
            disabled={busy}
            onChange={(event) => onWrite(event.target.checked)}
          />
        </label>
      )}

      <div className="consent-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => onAnswer(true)}
        >
          {busy ? 'Connecting…' : 'Connect'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => onAnswer(false)}
        >
          Cancel
        </button>
      </div>

      <p className="auth-switch consent-foot">
        You can disconnect it at any time in Settings, under Assistants.
        {name && (
          <>
            {' '}
            <button type="button" onClick={onSwitch}>
              Not {name}?
            </button>
          </>
        )}
      </p>
    </>
  );
}
