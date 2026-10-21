/** How you sign in, where you are signed in, and what has happened to your sign-in.
 *
 * Yours, across every workspace on this server: one address is one password in all of
 * them, and a session in any one reaches the rest through the switcher — so the devices
 * listed here, and "Sign out everywhere else", are every workspace's (M3 · B1).
 */

import { useState, type FormEvent } from 'react';
import { api, ApiError, type AccountEvent, type AuthSession } from '../../lib/api.ts';
import { useFetch } from '../../lib/useFetch.ts';
import type { ConsoleSectionProps } from '../console/ConsoleShell.tsx';
import { Card, CardNotice } from '../console/Card.tsx';
import { describeAgent, describeEvent, describeMethod } from './devices.ts';

export function SecuritySection({ onError }: ConsoleSectionProps) {
  // Bumped whenever something here changes what the other cards show: a password
  // change signs other devices out and writes to the record.
  const [version, setVersion] = useState(0);
  const changed = () => setVersion((n) => n + 1);

  return (
    <div className="console-stack">
      <PasswordCard onError={onError} onChanged={changed} />
      <DevicesCard onError={onError} version={version} onChanged={changed} />
      <ActivityCard version={version} />
    </div>
  );
}

function PasswordCard({
  onError,
  onChanged,
}: {
  onError: (message: string | null) => void;
  onChanged: () => void;
}) {
  const { data: state } = useFetch(() => api.auth.reauthState(), []);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  // Until the answer arrives, assume the usual case: there is a password to change.
  const hasPassword = state === null || state.methods.includes('password');
  const usable = next.length >= 10 && (!hasPassword || current.length > 0) && !busy;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!usable) return;
    setBusy(true);
    setDone(false);
    setFieldError(null);
    onError(null);
    try {
      await api.auth.changePassword({
        currentPassword: hasPassword ? current : undefined,
        newPassword: next,
      });
      setCurrent('');
      setNext('');
      setDone(true);
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'wrong_password') {
        setFieldError(err.message);
      } else if (!(err instanceof ApiError && err.code === 'reauth_cancelled')) {
        onError(err instanceof ApiError ? err.message : 'Your password could not be changed.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Password"
      description={
        hasPassword
          ? 'One password for every workspace you are in on this server.'
          : 'You sign in another way. Set a password to have one more.'
      }
    >
      <form className="console-stack" onSubmit={submit}>
        <div className="console-form-grid">
          {hasPassword && (
            <label className="field">
              <span className="field-label">Current password</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                aria-invalid={fieldError ? true : undefined}
              />
            </label>
          )}
          <label className="field">
            <span className="field-label">New password</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </label>
        </div>
        <p className="pref-hint">
          At least 10 characters. Every other device is signed out, in every workspace; assistants
          you have connected stay connected.
        </p>
        <div className="console-form-actions">
          <button className="btn btn-primary" type="submit" disabled={!usable}>
            {busy ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
          </button>
          {/* Always here, beside the button; only the words come and go, which is what
              gets them announced. */}
          <span aria-live="polite">
            {fieldError ? (
              <span className="error-text">{fieldError}</span>
            ) : done ? (
              <span className="pref-hint">Password changed. Other devices are signed out.</span>
            ) : null}
          </span>
        </div>
      </form>
    </Card>
  );
}

function DevicesCard({
  onError,
  version,
  onChanged,
}: {
  onError: (message: string | null) => void;
  version: number;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const { data: sessions, error } = useFetch(
    async (): Promise<AuthSession[]> => (await api.auth.sessions()).sessions,
    [version],
  );

  async function act(key: string, run: () => Promise<unknown>) {
    setBusy(key);
    onError(null);
    try {
      await run();
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  const workspaces = new Set((sessions ?? []).map((s) => s.workspaceId));
  const others = (sessions ?? []).filter((s) => !s.current);

  return (
    <Card
      title="Where you’re signed in"
      description="Every browser holding a session for you, in every workspace. Sign out any you do not recognise."
      footer={
        others.length > 0 ? (
          <button
            className="btn"
            disabled={busy !== null}
            onClick={() => void act('others', () => api.auth.logoutOthers())}
          >
            Sign out everywhere else
          </button>
        ) : undefined
      }
    >
      {error && <p className="error-text">Could not load your sessions.</p>}
      {!error && sessions === null && <CardNotice>Loading…</CardNotice>}
      {sessions?.map((session) => {
        const how = describeMethod(session.method);
        return (
          <div key={session.id} className="pref-row">
            <div className="grow min-0">
              <div className="pref-label">
                {describeAgent(session.userAgent)}
                {session.current && ' — this device'}
              </div>
              <div className="pref-hint">
                {[
                  workspaces.size > 1 ? session.workspace : null,
                  how ? `signed in ${how}` : null,
                  session.ip,
                  `last seen ${new Date(session.lastSeenAt).toLocaleString()}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            {!session.current && (
              <button
                className="btn btn-ghost"
                disabled={busy !== null}
                aria-label={`Sign out ${describeAgent(session.userAgent)}`}
                onClick={() => void act(session.id, () => api.auth.endSession(session.id))}
              >
                Sign out
              </button>
            )}
          </div>
        );
      })}
    </Card>
  );
}

function ActivityCard({ version }: { version: number }) {
  const { data, error } = useFetch(() => api.auth.activity(), [version]);
  const events: AccountEvent[] = data?.events ?? [];

  return (
    <Card
      title="Recent activity"
      description={`Sign-ins, wrong passwords and changes to how you sign in, from the last ${
        data?.keepDays ?? 90
      } days.`}
    >
      {error && <p className="error-text">Could not load your activity.</p>}
      {!error && data === null && <CardNotice>Loading…</CardNotice>}
      {data !== null && events.length === 0 && <CardNotice>Nothing yet.</CardNotice>}
      {events.map((event) => (
        <div key={event.id} className="pref-row" data-kind={event.kind}>
          <div className="grow min-0">
            <div className="pref-label">{describeEvent(event)}</div>
            <div className="pref-hint">
              {[
                describeAgent(event.userAgent),
                event.workspace,
                event.ip,
                new Date(event.createdAt).toLocaleString(),
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
        </div>
      ))}
    </Card>
  );
}
