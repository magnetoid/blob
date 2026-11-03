/** How you sign in, where you are signed in, and what has happened to your sign-in.
 *
 * Yours, across every workspace on this server: one address is one password in all of
 * them, and a session in any one reaches the rest through the switcher — so the devices
 * listed here, and "Sign out everywhere else", are every workspace's (M3 · B1).
 */

import { useEffect, useId, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { DialogPresence } from '../../components/Dialog.tsx';
import {
  api,
  ApiError,
  type AccountEvent,
  type AuthSession,
  type PasskeyRow,
  type SsoIdentity,
} from '../../lib/api.ts';
import { createPasskey, forgetPasskey, isCancel, passkeysSupported } from '../../lib/passkeys.ts';
import { useFetch } from '../../lib/useFetch.ts';
import { formatRelative } from '../messages/messageFormatting.ts';
import type { ConsoleSectionProps } from '../console/ConsoleShell.tsx';
import { Card, CardNotice, CardRow, CardRows } from '../console/Card.tsx';
import { clearSsoParams, ssoMessage } from '../auth/sso.ts';
import { describeAgent, describeEvent, describeMethod } from './devices.ts';
import { Alert, AlertDescription } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { ItemActions, ItemContent, ItemDescription, ItemTitle } from '../../components/ui/item.tsx';
import { Switch } from '../../components/ui/switch.tsx';

export function SecuritySection({ onError }: ConsoleSectionProps) {
  // Bumped whenever something here changes what the other cards show: a password
  // change signs other devices out and writes to the record.
  const [version, setVersion] = useState(0);
  const changed = () => setVersion((n) => n + 1);

  return (
    <div className="flex flex-col gap-6">
      <PasswordCard onError={onError} onChanged={changed} />
      <PasskeysCard onError={onError} version={version} onChanged={changed} />
      <SingleSignOnCard onError={onError} version={version} onChanged={changed} />
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
  const newPasswordHint = useId();
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
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <FieldGroup className="grid max-w-190 grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-x-5 gap-y-4">
          {hasPassword && (
            <Field data-invalid={fieldError ? true : undefined}>
              <FieldLabel htmlFor="current-password">Current password</FieldLabel>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? 'current-password-error' : undefined}
              />
              {fieldError && <FieldError id="current-password-error">{fieldError}</FieldError>}
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              aria-describedby={newPasswordHint}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
        </FieldGroup>
        <FieldDescription id={newPasswordHint}>
          At least 10 characters. Every other device is signed out, in every workspace;
          assistants you have connected stay connected.
        </FieldDescription>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!usable}>
            {busy ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
          </Button>
          {/* Always here, beside the button; only the words come and go, which is what
              gets them announced. */}
          <span aria-live="polite" className="text-sm text-muted-foreground">
            {done ? 'Password changed. Other devices are signed out.' : null}
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
  const twoStepHint = useId();
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
        <Button
          variant="outline"
          disabled={!supported || busy !== null}
          title={supported ? undefined : 'This browser cannot make passkeys.'}
          onClick={() => void add()}
        >
          {busy === 'add' ? 'Adding…' : 'Add a passkey'}
        </Button>
      }
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription>Could not load your passkeys.</AlertDescription>
        </Alert>
      )}
      {!error && data === null && <CardNotice>Loading…</CardNotice>}
      {data !== null && passkeys.length === 0 && (
        <CardNotice>
          None yet. Add one and this device can sign you in without your password.
        </CardNotice>
      )}
      {passkeys.length > 0 && (
        <CardRows>
          {passkeys.map((passkey) => (
            <CardRow key={passkey.id} data-passkey={passkey.id}>
              {renaming?.id === passkey.id ? (
                <form
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
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
                  <Input
                    className="min-w-40 flex-1"
                    aria-label="Passkey name"
                    value={renaming.name}
                    maxLength={60}
                    onChange={(e) => setRenaming({ id: passkey.id, name: e.target.value })}
                  />
                  <Button type="submit">Save</Button>
                  <Button variant="ghost" type="button" onClick={() => setRenaming(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <>
                  <ItemContent>
                    <ItemTitle>{passkey.name}</ItemTitle>
                    <ItemDescription>
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
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      variant="ghost"
                      disabled={busy !== null}
                      aria-label={`Rename ${passkey.name}`}
                      onClick={() => setRenaming({ id: passkey.id, name: passkey.name })}
                    >
                      Rename
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy !== null}
                      aria-label={`Remove ${passkey.name}`}
                      onClick={() => setRemoving(passkey)}
                    >
                      Remove
                    </Button>
                  </ItemActions>
                </>
              )}
            </CardRow>
          ))}
        </CardRows>
      )}
      {passkeys.length > 0 && (
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="passkey-two-step">Ask for a passkey after my password</FieldLabel>
            <FieldDescription id={twoStepHint}>
              Then a password alone no longer signs in as you, in any workspace here. Signing in
              with a passkey alone still works.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="passkey-two-step"
            aria-describedby={twoStepHint}
            checked={data?.twoStep ?? false}
            disabled={busy !== null}
            onCheckedChange={(on) =>
              void run('two-step', () => api.passkeys.setTwoStep(on), 'That could not be changed.')
            }
          />
        </Field>
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

/** What linking at a provider came back with, from the address it came back to. */
function linkOutcome(): string | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get('sso') === 'linked') return 'Linked. You can sign in with it from now on.';
  const code = params.get('sso_error');
  return code ? ssoMessage(code) : null;
}

function SingleSignOnCard({
  onError,
  version,
  onChanged,
}: {
  onError: (message: string | null) => void;
  version: number;
  onChanged: () => void;
}) {
  const { data, error } = useFetch(() => api.sso.identities(), [version]);
  const [busy, setBusy] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState<SsoIdentity | null>(null);
  const [outcome] = useState(linkOutcome);
  useEffect(() => clearSsoParams(), []);

  // A server with no providers has nothing to offer here, so says nothing.
  if (!error && data !== null && data.identities.length === 0 && data.available.length === 0) {
    return null;
  }

  async function link(slug: string) {
    setBusy(slug);
    onError(null);
    try {
      const { url } = await api.sso.begin({
        provider: slug,
        intent: 'link',
        next: '/settings/security',
      });
      window.location.assign(url);
    } catch (err) {
      if (!(err instanceof ApiError && err.code === 'reauth_cancelled')) {
        onError(err instanceof ApiError ? err.message : 'That could not start.');
      }
      setBusy(null);
    }
  }

  const rows = (data?.identities.length ?? 0) + (data?.available.length ?? 0);

  return (
    <Card
      title="Single sign-on"
      description="Sign in with your organisation’s account instead of a password here."
    >
      {outcome && (
        <p role="status" className="text-sm text-muted-foreground">
          {outcome}
        </p>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>Could not load single sign-on.</AlertDescription>
        </Alert>
      )}
      {!error && data === null && <CardNotice>Loading…</CardNotice>}
      {rows > 0 && (
        <CardRows>
          {data?.identities.map((identity) => (
            <CardRow key={identity.providerId}>
              <ItemContent>
                <ItemTitle>{identity.name}</ItemTitle>
                <ItemDescription>
                  {[
                    identity.linkedAt
                      ? `linked ${new Date(identity.linkedAt).toLocaleDateString()}`
                      : 'linked',
                    identity.lastUsedAt
                      ? `last used ${formatRelative(identity.lastUsedAt)}`
                      : 'not used yet',
                  ].join(' · ')}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  variant="ghost"
                  disabled={busy !== null}
                  aria-label={`Unlink ${identity.name}`}
                  onClick={() => setUnlinking(identity)}
                >
                  Unlink
                </Button>
              </ItemActions>
            </CardRow>
          ))}
          {data?.available.map((provider) => (
            <CardRow key={provider.slug}>
              <ItemContent>
                <ItemTitle>{provider.name}</ItemTitle>
                <ItemDescription>Not linked</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void link(provider.slug)}
                >
                  {busy === provider.slug ? 'Opening…' : `Link ${provider.name}`}
                </Button>
              </ItemActions>
            </CardRow>
          ))}
        </CardRows>
      )}

      <DialogPresence when={unlinking}>
        {(identity) => (
          <ConfirmDialog
            title={`Unlink ${identity.name}?`}
            body="It will no longer sign you in here. If it is the only way you have in, set a password or add a passkey first."
            confirmLabel="Unlink"
            danger
            onClose={() => setUnlinking(null)}
            onConfirm={() => {
              const target = identity;
              setUnlinking(null);
              setBusy('unlink');
              onError(null);
              void api.sso
                .unlink(target.providerId)
                .then(onChanged)
                .catch((err: unknown) => {
                  if (!(err instanceof ApiError && err.code === 'reauth_cancelled')) {
                    onError(err instanceof ApiError ? err.message : 'That could not be unlinked.');
                  }
                })
                .finally(() => setBusy(null));
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
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() => void act('others', () => api.auth.logoutOthers())}
          >
            Sign out everywhere else
          </Button>
        ) : undefined
      }
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription>Could not load your sessions.</AlertDescription>
        </Alert>
      )}
      {!error && sessions === null && <CardNotice>Loading…</CardNotice>}
      {sessions !== null && sessions.length > 0 && (
        <CardRows>
          {sessions.map((session) => {
            const how = describeMethod(session.method);
            return (
              <CardRow key={session.id}>
                <ItemContent>
                  <ItemTitle>
                    {describeAgent(session.userAgent)}
                    {session.current && ' — this device'}
                  </ItemTitle>
                  <ItemDescription>
                    {[
                      workspaces.size > 1 ? session.workspace : null,
                      how ? `signed in ${how}` : null,
                      session.ip,
                      `last seen ${formatRelative(session.lastSeenAt)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </ItemDescription>
                </ItemContent>
                {!session.current && (
                  <ItemActions>
                    <Button
                      variant="ghost"
                      disabled={busy !== null}
                      aria-label={`Sign out ${describeAgent(session.userAgent)}`}
                      onClick={() => void act(session.id, () => api.auth.endSession(session.id))}
                    >
                      Sign out
                    </Button>
                  </ItemActions>
                )}
              </CardRow>
            );
          })}
        </CardRows>
      )}
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
      {error && (
        <Alert variant="destructive">
          <AlertDescription>Could not load your activity.</AlertDescription>
        </Alert>
      )}
      {!error && data === null && <CardNotice>Loading…</CardNotice>}
      {data !== null && events.length === 0 && <CardNotice>Nothing yet.</CardNotice>}
      {events.length > 0 && (
        <CardRows>
          {events.map((event) => (
            <CardRow key={event.id} data-kind={event.kind}>
              <ItemContent>
                <ItemTitle>{describeEvent(event)}</ItemTitle>
                <ItemDescription>
                  {[
                    describeAgent(event.userAgent),
                    event.workspace,
                    event.ip,
                    new Date(event.createdAt).toLocaleString(),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </ItemDescription>
              </ItemContent>
            </CardRow>
          ))}
        </CardRows>
      )}
    </Card>
  );
}
