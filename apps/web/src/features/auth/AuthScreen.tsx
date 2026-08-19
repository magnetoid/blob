/** Sign in, sign up, and first-run workspace setup. */

import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../lib/api.ts';

type Mode = 'login' | 'signup';

interface Props {
  needsSetup: boolean;
  onSignedIn: () => Promise<void>;
}

/** An invite link lands on /join/<token>; pick the token up from the URL. */
function inviteTokenFromUrl(): string | null {
  const match = window.location.pathname.match(/^\/join\/(.+)$/);
  return match?.[1] ?? null;
}

export function AuthScreen({ needsSetup, onSignedIn }: Props) {
  const inviteToken = inviteTokenFromUrl();
  const [mode, setMode] = useState<Mode>(needsSetup || inviteToken ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [inviteWorkspace, setInviteWorkspace] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!inviteToken) return;
    void api.auth
      .invite(inviteToken)
      .then((invite) => {
        setInviteWorkspace(invite.workspace);
        if (invite.email) setEmail(invite.email);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'That invitation is not valid.');
      });
  }, [inviteToken]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await api.auth.login(email, password);
      } else {
        await api.auth.signup({
          email,
          password,
          displayName,
          workspaceName: needsSetup ? workspaceName || 'Workspace' : undefined,
          inviteToken: inviteToken ?? undefined,
        });
      }
      // Drop the invite token from the URL so a refresh doesn't retry it.
      if (inviteToken) window.history.replaceState(null, '', '/');
      await onSignedIn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  const title = needsSetup
    ? 'Set up your workspace'
    : mode === 'login'
      ? 'Sign in'
      : inviteWorkspace
        ? `Join ${inviteWorkspace}`
        : 'Create your account';

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div>
          <div className="auth-mark" aria-hidden="true">
            B
          </div>
          <h1 className="auth-title" style={{ marginTop: 18 }}>
            {title}
          </h1>
          {needsSetup && (
            <p className="auth-subtitle">
              You're the first person here, so this account becomes the workspace owner.
            </p>
          )}
        </div>

        {needsSetup && (
          <label className="field">
            <span className="field-label">Workspace name</span>
            <input
              className="input"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="Acme"
              autoFocus
            />
          </label>
        )}

        {mode === 'signup' && (
          <label className="field">
            <span className="field-label">Display name</span>
            <input
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Ana"
              required
              maxLength={40}
            />
          </label>
        )}

        <label className="field">
          <span className="field-label">Email</span>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>

        <label className="field">
          <span className="field-label">Password</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'signup' ? 10 : 1}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
          {mode === 'signup' && <span className="muted" style={{ fontSize: 13 }}>At least 10 characters.</span>}
        </label>

        {error && <p className="error-text">{error}</p>}

        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>

        {!needsSetup && !inviteToken && (
          <p className="auth-switch">
            {mode === 'login' ? (
              <>
                Have an invitation?{' '}
                <button type="button" onClick={() => setMode('signup')}>
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already here?{' '}
                <button type="button" onClick={() => setMode('login')}>
                  Sign in
                </button>
              </>
            )}
          </p>
        )}
      </form>
    </div>
  );
}
