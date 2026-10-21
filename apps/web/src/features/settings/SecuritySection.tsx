/** How you sign in, where you are signed in, and what has happened to your sign-in.
 *
 * Yours, across every workspace on this server: one address is one password in all of
 * them, and a session in any one reaches the rest through the switcher — so the devices
 * listed here, and "Sign out everywhere else", are every workspace's (M3 · B1).
 */

import { useState, type FormEvent } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { DialogPresence } from '../../components/Dialog.tsx';
import {
  api,
  ApiError,
  type AccountEvent,
  type AuthSession,
  type PasskeyRow,
} from '../../lib/api.ts';
import { createPasskey, forgetPasskey, isCancel, passkeysSupported } from '../../lib/passkeys.ts';
import { useFetch } from '../../lib/useFetch.ts';
import { formatRelative } from '../messages/messageFormatting.ts';
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
      <PasskeysCard onError={onError} version={version} onChanged={changed} />
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
      <form className="console-form" onSubmit={submit}>
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

/** What went wrong with a passkey, in words — or nothing, when the person simply said no. */
function passkeyTrouble(err: unknown, fallback: string): string | null {
  if (isCancel(err)) return null;
  if (err instanceof ApiError) return err.code === 'reauth_cancelled' ? null : err.message;
  if (err instanceof DOMException && err.name === 'InvalidStateError') {
    return 'This device already holds a passkey for you.';
  }
  return fallback;
}

function PasskeysCard({
  onError,
  version,
  onChanged,
}: {
  onError: (message: string | null) => void;
  version: number;
  onChanged: () => void;
}) {
  const { data, error } = useFetch(() => api.passkeys.list(), [version]);
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<PasskeyRow | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const supported = passkeysSupported();
  const passkeys = data?.passkeys ?? [];

  async function run(key: string, work: () => Promise<unknown>, fallback: string) {
    setBusy(key);
    onError(null);
    try {
      await work();
      onChanged();
    } catch (err) {
      const trouble = passkeyTrouble(err, fallback);
      if (trouble) onError(trouble);
    } finally {
      setBusy(null);
    }
  }

  const add = () =>
    run(
      'add',
      async () => {
        const { options } = await api.passkeys.options();
        const credential = await createPasskey(options);
        // Named after where it was made; renamed below if the person likes.
        await api.passkeys.add(credential, describeAgent(navigator.userAgent));
      },
      'That passkey could not be added.',
    );

  return (
    <Card
      title="Passkeys"
      description="Sign in with your fingerprint, face or device PIN instead of typing a password. A passkey is yours in every workspace here."
      footer={
        <button
          className="btn"
          disabled={!supported || busy !== null}
          title={supported ? undefined : 'This browser cannot make passkeys.'}
          onClick={() => void add()}
        >
          {busy === 'add' ? 'Adding…' : 'Add a passkey'}
        </button>
      }
    >
      {error && <p className="error-text">Could not load your passkeys.</p>}
      {!error && data === null && <CardNotice>Loading…</CardNotice>}
      {data !== null && passkeys.length === 0 && (
        <CardNotice>
          None yet. Add one and this device can sign you in without your password.
        </CardNotice>
      )}
      {passkeys.map((passkey) => (
        <div key={passkey.id} className="pref-row" data-passkey={passkey.id}>
          {renaming?.id === passkey.id ? (
            <form
              className="console-inline-form grow"
              onSubmit={(event) => {
                event.preventDefault();
                const name = renaming.name.trim();
                if (!name) return;
                setRenaming(null);
                void run(
                  'rename',
                  () => api.passkeys.rename(passkey.id, name),
                  'It could not be renamed.',
                );
              }}
            >
              <input
                className="input"
                aria-label="Passkey name"
                value={renaming.name}
                maxLength={60}
                onChange={(e) => setRenaming({ id: passkey.id, name: e.target.value })}
              />
              <button className="btn btn-primary" type="submit">
                Save
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setRenaming(null)}>
                Cancel
              </button>
            </form>
          ) : (
            <>
              <div className="grow min-0">
                <div className="pref-label">{passkey.name}</div>
                <div className="pref-hint">
                  {[
                    passkey.backedUp ? 'synced to your other devices' : 'on one device only',
                    passkey.createdAt
                      ? `added ${new Date(passkey.createdAt).toLocaleDateString()}`
                      : null,
                    passkey.lastUsedAt
                      ? `last used ${formatRelative(passkey.lastUsedAt)}`
                      : 'not used yet',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <button
                className="btn btn-ghost"
                disabled={busy !== null}
                aria-label={`Rename ${passkey.name}`}
                onClick={() => setRenaming({ id: passkey.id, name: passkey.name })}
              >
                Rename
              </button>
              <button
                className="btn btn-ghost"
                disabled={busy !== null}
                aria-label={`Remove ${passkey.name}`}
                onClick={() => setRemoving(passkey)}
              >
                Remove
              </button>
            </>
          )}
        </div>
      ))}
      {passkeys.length > 0 && (
        <div className="pref-row">
          <div className="grow">
            <div className="pref-label">Ask for a passkey after my password</div>
            <div className="pref-hint">
              Then a password alone no longer signs in as you, in any workspace here. Signing in
              with a passkey alone still works.
            </div>
          </div>
          <button
            className="toggle"
            aria-pressed={data?.twoStep ?? false}
            aria-label="Ask for a passkey after my password"
            disabled={busy !== null}
            onClick={() =>
              void run(
                'two-step',
                () => api.passkeys.setTwoStep(!(data?.twoStep ?? false)),
                'That could not be changed.',
              )
            }
          >
            <span />
          </button>
        </div>
      )}

      <DialogPresence when={removing}>
        {(passkey) => (
          <ConfirmDialog
            title={`Remove ${passkey.name}?`}
            body="It will no longer sign you in here. The device or password manager may still offer it until it hears it was removed."
            confirmLabel="Remove"
            danger
            onClose={() => setRemoving(null)}
            onConfirm={() => {
              const target = passkey;
              setRemoving(null);
              void run(
                'remove',
                async () => forgetPasskey((await api.passkeys.remove(target.id)).credentialId),
                'That passkey could not be removed.',
              );
            }}
          />
        )}
      </DialogPresence>
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
                  `last seen ${formatRelative(session.lastSeenAt)}`,
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
