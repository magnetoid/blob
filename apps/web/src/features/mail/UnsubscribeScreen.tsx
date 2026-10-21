/** The page an away email's "Stop these emails" link opens (ADR 0036).
 *
 * It says whose emails the link stops before anything is stopped, and stops them only
 * when asked: mail scanners fetch every link in a message, and a page that unsubscribed
 * on being opened would unsubscribe people who never clicked. It works signed out —
 * the token in the address is the whole of its authority — and it can do nothing else.
 */

import { useState } from 'react';
import { api, ApiError, type UnsubscribeInfo } from '../../lib/api.ts';
import { useFetch } from '../../lib/useFetch.ts';

export function UnsubscribeScreen({ token }: { token: string }) {
  const looked = useFetch(() => api.mail.unsubscribeInfo(token), [token]);
  const [stopped, setStopped] = useState<UnsubscribeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function stop() {
    setBusy(true);
    setError(null);
    try {
      setStopped(await api.mail.unsubscribe(token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const info = stopped ?? looked.data;
  const broken = looked.error !== null && !stopped;

  return (
    <div className="auth">
      <main className="auth-card" aria-busy={looked.loading}>
        <div className="auth-mark" aria-hidden="true">
          B
        </div>
        {looked.loading && !info && <p className="muted m-0">Checking the link…</p>}

        {broken && (
          <>
            <h1 className="auth-title">This link does not work</h1>
            <p className="auth-subtitle">
              You can still change which emails Blob sends you under Notifications in your
              settings.
            </p>
            <a className="btn btn-ghost" href="/settings/preferences">
              Open Blob
            </a>
          </>
        )}

        {info && !info.off && (
          <>
            <h1 className="auth-title">Stop emails when you are away?</h1>
            <p className="auth-subtitle">
              Blob emails <strong>{info.email}</strong> about direct messages, mentions and
              thread replies in {info.workspace} that wait unread while you are away.
            </p>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void stop()}
            >
              {busy ? 'Stopping…' : 'Stop these emails'}
            </button>
          </>
        )}

        {info?.off && (
          <>
            <h1 className="auth-title">
              {stopped ? 'Stopped' : 'These emails are already off'}
            </h1>
            <p className="auth-subtitle" role="status">
              Blob will not email <strong>{info.email}</strong> about {info.workspace} while
              you are away. Turn them back on any time under Notifications in your settings.
            </p>
            <a className="btn btn-ghost" href="/settings/preferences">
              Open Blob
            </a>
          </>
        )}
      </main>
    </div>
  );
}
