/** "Confirm it's you" — asked before an action that hands somebody else your reach.
 *
 * Mounted once wherever a signed-in person can act (the workspace, the consent page).
 * It does not decide when to ask: the server does, refusing with `reauth_required`, and
 * `lib/stepUp.ts` brings that refusal here. Answering sends the refused request again;
 * cancelling leaves it refused, and nothing was changed.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Dialog, DialogPresence } from '../../components/Dialog.tsx';
import { api, ApiError, type ReauthState } from '../../lib/api.ts';
import { getPasskey, isCancel, passkeysSupported } from '../../lib/passkeys.ts';
import { setAsker } from '../../lib/stepUp.ts';
import { useFetch } from '../../lib/useFetch.ts';

interface Question {
  answer: (confirmed: boolean) => void;
}

export function ConfirmItsYou() {
  const [question, setQuestion] = useState<Question | null>(null);
  // The open question's answer, for the unmount: a question left open when this goes
  // away — signing out with the prompt up — would otherwise never be answered, and
  // every sensitive action after it would wait on it forever.
  const open = useRef<((confirmed: boolean) => void) | null>(null);

  useEffect(() => {
    const stop = setAsker(
      () =>
        new Promise<boolean>((resolve) => {
          const answer = (confirmed: boolean) => {
            open.current = null;
            setQuestion(null);
            resolve(confirmed);
          };
          open.current = answer;
          setQuestion({ answer });
        }),
    );
    return () => {
      open.current?.(false);
      stop();
    };
  }, []);

  return (
    <DialogPresence when={question}>
      {(asked) => <ConfirmDialog onAnswer={asked.answer} />}
    </DialogPresence>
  );
}

function ConfirmDialog({ onAnswer }: { onAnswer: (confirmed: boolean) => void }) {
  const { data: state } = useFetch((): Promise<ReauthState> => api.auth.reauthState(), []);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const minutes = state?.windowMinutes ?? 15;

  // Focused on mount, the way every dialog here does it: the one thing to do is type.
  useEffect(() => inputRef.current?.focus(), []);
  const hasPassword = state === null || state.methods.includes('password');
  const hasPasskey = state !== null && state.methods.includes('passkey') && passkeysSupported();

  async function withPasskey() {
    setBusy(true);
    setError(null);
    try {
      const { flowId, options } = await api.passkeys.confirmOptions();
      await api.passkeys.confirm(flowId, await getPasskey(options));
      onAnswer(true);
    } catch (err) {
      if (!isCancel(err)) {
        setError(err instanceof ApiError ? err.message : 'That passkey could not be checked.');
      }
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await api.auth.reauth(password);
      onAnswer(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That didn’t work. Try again.');
      setBusy(false);
    }
  }

  return (
    <Dialog label="Confirm it’s you" onClose={() => onAnswer(false)}>
      <form className="dialog" onSubmit={submit}>
        <h2 className="dialog-title">Confirm it’s you</h2>
        <p className="pref-hint">
          This gives someone or something access — an assistant, an app, a role, a way into an
          account — so it needs you to prove it’s you first. You won’t be asked again for{' '}
          {minutes} minutes.
        </p>
        {hasPassword && (
          <label className="field">
            <span className="field-label">Password</span>
            <input
              ref={inputRef}
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {!hasPassword && !hasPasskey && (
          <p className="pref-hint">
            Your account has no password or passkey to confirm with. Set a password under Sign-in
            &amp; security, then try again.
          </p>
        )}
        <div aria-live="polite">{error && <p className="error-text">{error}</p>}</div>
        <div className="dialog-actions">
          <button className="btn" type="button" onClick={() => onAnswer(false)}>
            Cancel
          </button>
          {hasPasskey && (
            <button
              className={hasPassword ? 'btn' : 'btn btn-primary'}
              type="button"
              disabled={busy}
              onClick={() => void withPasskey()}
            >
              Use a passkey
            </button>
          )}
          {hasPassword && (
            <button className="btn btn-primary" type="submit" disabled={busy || !password}>
              {busy ? 'Confirming…' : 'Confirm'}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
