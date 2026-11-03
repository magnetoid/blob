/** Single sign-on providers — the server administrator's (ADR 0033).
 *
 * A provider is the server's, not a workspace's: one address is one person across every
 * workspace here, so whoever vouches for them does so everywhere. The page says the one
 * address to register at the provider, and never shows a client secret back — only
 * whether one is set.
 */

import { useId, useState, type FormEvent } from 'react';
import { cn } from 'cn';
import {
  api,
  ApiError,
  type InstanceWorkspace,
  type SsoProvider,
  type SsoProviderInput,
} from '../../../lib/api.ts';
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx';
import { DialogPresence } from '../../../components/Dialog.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Checkbox } from '../../../components/ui/checkbox.tsx';
import { Field, FieldContent, FieldDescription, FieldLabel } from '../../../components/ui/field.tsx';
import { Input } from '../../../components/ui/input.tsx';
import { ItemContent, ItemDescription, ItemTitle } from '../../../components/ui/item.tsx';
import { NativeSelect, NativeSelectOption } from '../../../components/ui/native-select.tsx';
import type { ConsoleSectionProps } from '../../console/ConsoleShell.tsx';
import { Card, CardNotice, CardRow, CardRows } from '../../console/Card.tsx';
import { CopyField } from '../../console/CopyField.tsx';
import { useAdminAction, useAdminData } from '../../console/hooks.ts';

function failure(err: unknown): string {
  return err instanceof ApiError ? err.message : 'That did not work.';
}

export function SsoSection({ onError }: ConsoleSectionProps) {
  const { data, loading, reload } = useAdminData(
    () => api.admin.ssoProviders(),
    [],
    onError,
    'Could not load the providers.',
  );
  const workspaces = useAdminData(
    () => api.admin.instanceWorkspaces(),
    [],
    onError,
    'Could not load the workspaces.',
  );
  const act = useAdminAction(onError, reload);
  const [editing, setEditing] = useState<SsoProvider | null>(null);
  const [removing, setRemoving] = useState<SsoProvider | null>(null);
  const [checked, setChecked] = useState<Record<string, { ok: boolean; message: string }>>({});
  const providers = data?.providers ?? [];
  const spaces = workspaces.data?.workspaces ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="How it works"
        description="People sign in with the account their organisation already gives them — Google Workspace, Microsoft Entra, Okta, Keycloak, anything that speaks OpenID Connect."
      >
        <p className="m-0 max-w-[68ch] text-sm text-pretty text-muted-foreground">
          Register this one address at the provider as the redirect (callback) address, then connect
          it below with the client id and secret the provider gives you.
        </p>
        {data && <CopyField label="Redirect address" value={data.callbackUrl} />}
      </Card>

      {loading && providers.length === 0 && (
        <Card>
          <CardNotice>Loading…</CardNotice>
        </Card>
      )}

      {providers.map((provider) =>
        editing?.id === provider.id ? (
          <ProviderForm
            key={provider.id}
            provider={provider}
            workspaces={spaces}
            onError={onError}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              reload();
            }}
          />
        ) : (
          <Card
            key={provider.id}
            title={provider.name}
            description={provider.issuer}
            actions={
              <>
                {/* Named by the provider they act on: there is a card of these for each. */}
                <Button
                  variant="outline"
                  aria-label={`Check ${provider.name}`}
                  onClick={() =>
                    void api.admin
                      .checkSso(provider.id)
                      .then((answer) => setChecked((all) => ({ ...all, [provider.id]: answer })))
                      .catch((err: unknown) => onError(failure(err)))
                  }
                >
                  Check
                </Button>
                <Button
                  variant="outline"
                  aria-label={`Edit ${provider.name}`}
                  onClick={() => setEditing(provider)}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Remove ${provider.name}`}
                  onClick={() => setRemoving(provider)}
                >
                  Remove
                </Button>
              </>
            }
          >
            {!provider.enabled && (
              <CardNotice>Switched off: its button is not on the sign-in page.</CardNotice>
            )}
            {checked[provider.id] && (
              <p
                role="status"
                className={cn(
                  'm-0 text-sm wrap-anywhere',
                  checked[provider.id]?.ok ? 'text-muted-foreground' : 'text-destructive',
                )}
              >
                {checked[provider.id]?.message}
              </p>
            )}
            <CardRows aria-label={`About ${provider.name}`}>
              <CardRow>
                <ItemContent>
                  <ItemTitle>Signs in</ItemTitle>
                  <ItemDescription>
                    {provider.linked === 1 ? '1 person' : `${provider.linked} people`} ·{' '}
                    {provider.allowedDomains.length > 0
                      ? `addresses at ${provider.allowedDomains.join(', ')}`
                      : 'any address'}{' '}
                    ·{' '}
                    {provider.linkByEmail
                      ? 'links existing accounts by verified address'
                      : 'people link it themselves'}
                  </ItemDescription>
                </ItemContent>
              </CardRow>
              <CardRow>
                <ItemContent>
                  <ItemTitle>New people</ItemTitle>
                  <ItemDescription>
                    {provider.joinWorkspaceId
                      ? `Join ${spaces.find((w) => w.id === provider.joinWorkspaceId)?.name ?? 'a workspace'} as members`
                      : 'Need an invitation'}
                  </ItemDescription>
                </ItemContent>
              </CardRow>
              <CardRow>
                <ItemContent>
                  <ItemTitle>Client</ItemTitle>
                  {/* The id is data and may be one long token. The secret itself is never
                      here: the server does not return it, only whether one is set. */}
                  <ItemDescription className="wrap-anywhere">
                    {provider.clientId} ·{' '}
                    {provider.hasSecret ? 'secret set' : 'no secret (public client)'} · button name “
                    {provider.slug}”
                  </ItemDescription>
                </ItemContent>
              </CardRow>
            </CardRows>
          </Card>
        ),
      )}

      {editing === null && (
        <ProviderForm provider={null} workspaces={spaces} onError={onError} onSaved={reload} />
      )}

      <DialogPresence when={removing}>
        {(provider) => (
          <ConfirmDialog
            title={`Remove ${provider.name}?`}
            body={
              provider.linked > 0
                ? `${provider.linked === 1 ? 'One person signs' : `${provider.linked} people sign`} in with it. Anyone with no password or passkey here will need a password reset to get back in.`
                : 'Its button leaves the sign-in page.'
            }
            confirmLabel="Remove"
            danger
            onClose={() => setRemoving(null)}
            onConfirm={() => {
              const target = provider;
              setRemoving(null);
              void act(() => api.admin.deleteSso(target.id));
            }}
          />
        )}
      </DialogPresence>
    </div>
  );
}

/** What the form shows before anything is typed: the provider's own, or a new one's defaults. */
function initialValues(provider: SsoProvider | null) {
  return {
    name: provider?.name ?? '',
    slug: '',
    issuer: provider?.issuer ?? '',
    clientId: provider?.clientId ?? '',
    // Never the secret: the server does not return it, so a form for a provider that has one
    // starts blank and says so in its placeholder.
    clientSecret: '',
    scopes: provider?.scopes ?? 'openid email profile',
    allowedDomains: provider?.allowedDomains.join(', ') ?? '',
    joinWorkspaceId: provider?.joinWorkspaceId ?? '',
    linkByEmail: provider?.linkByEmail ?? true,
    enabled: provider?.enabled ?? true,
  };
}

function ProviderForm({
  provider,
  workspaces,
  onError,
  onSaved,
  onCancel,
}: {
  provider: SsoProvider | null;
  workspaces: InstanceWorkspace[];
  onError: (message: string | null) => void;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState(() => initialValues(provider));
  const ids = useId();
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: SsoProviderInput = {
      name: values.name.trim(),
      issuer: values.issuer.trim(),
      clientId: values.clientId.trim(),
      clientSecret: values.clientSecret.trim() || undefined,
      scopes: values.scopes.trim() || 'openid email profile',
      allowedDomains: values.allowedDomains
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean),
      linkByEmail: values.linkByEmail,
      joinWorkspaceId: values.joinWorkspaceId || null,
      enabled: values.enabled,
    };
    onError(null);
    setBusy(true);
    try {
      if (provider) await api.admin.updateSso(provider.id, input);
      else {
        await api.admin.createSso({ ...input, slug: values.slug.trim() });
        // A new provider's form is ready for the next one, and the secret is not left in it.
        setValues(initialValues(null));
      }
      onSaved();
    } catch (err) {
      if (!(err instanceof ApiError && err.code === 'reauth_cancelled')) onError(failure(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={provider ? `Edit ${provider.name}` : 'Connect a provider'}
      description={
        provider
          ? 'Leave the secret blank to keep the one that is set.'
          : 'Blob reads the provider’s own description of itself before saving, so a mistyped address shows here.'
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${ids}-name`}>Button name</FieldLabel>
            <Input
              id={`${ids}-name`}
              value={values.name}
              placeholder="Acme"
              maxLength={60}
              required
              onChange={(event) => set('name', event.target.value)}
            />
          </Field>
          {!provider && (
            <Field>
              <FieldLabel htmlFor={`${ids}-slug`}>Short name</FieldLabel>
              <Input
                id={`${ids}-slug`}
                value={values.slug}
                placeholder="acme"
                pattern="[a-z0-9][a-z0-9\-]{1,30}"
                title="Lowercase letters, numbers and hyphens"
                required
                onChange={(event) => set('slug', event.target.value)}
              />
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor={`${ids}-issuer`}>Issuer</FieldLabel>
            <Input
              id={`${ids}-issuer`}
              type="url"
              value={values.issuer}
              placeholder="https://accounts.google.com"
              spellCheck={false}
              required
              onChange={(event) => set('issuer', event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${ids}-client`}>Client id</FieldLabel>
            <Input
              id={`${ids}-client`}
              value={values.clientId}
              spellCheck={false}
              required
              onChange={(event) => set('clientId', event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${ids}-secret`}>Client secret</FieldLabel>
            <Input
              id={`${ids}-secret`}
              type="password"
              autoComplete="off"
              value={values.clientSecret}
              placeholder={provider?.hasSecret ? 'Set — leave blank to keep' : ''}
              onChange={(event) => set('clientSecret', event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${ids}-scopes`}>Scopes</FieldLabel>
            <Input
              id={`${ids}-scopes`}
              value={values.scopes}
              spellCheck={false}
              onChange={(event) => set('scopes', event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${ids}-domains`}>Only these domains</FieldLabel>
            <Input
              id={`${ids}-domains`}
              value={values.allowedDomains}
              placeholder="acme.com, acme.co.uk"
              spellCheck={false}
              aria-describedby={`${ids}-domains-hint`}
              onChange={(event) => set('allowedDomains', event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${ids}-join`}>New people</FieldLabel>
            <NativeSelect
              id={`${ids}-join`}
              className="w-full"
              value={values.joinWorkspaceId}
              onChange={(event) => set('joinWorkspaceId', event.target.value)}
            >
              <NativeSelectOption value="">Need an invitation</NativeSelectOption>
              {workspaces.map((workspace) => (
                <NativeSelectOption key={workspace.id} value={workspace.id}>
                  Join {workspace.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <p
          id={`${ids}-domains-hint`}
          className="m-0 max-w-[68ch] text-sm text-pretty text-muted-foreground"
        >
          With no domains named, anyone the provider has verified may sign in to an account that
          already exists here. Letting new people join without an invitation needs the domains
          named — otherwise anyone with an account at the provider could.
        </p>
        <Field orientation="horizontal">
          <Checkbox
            id={`${ids}-link`}
            checked={values.linkByEmail}
            aria-describedby={`${ids}-link-hint`}
            onCheckedChange={(on) => set('linkByEmail', on)}
          />
          <FieldContent>
            <FieldLabel htmlFor={`${ids}-link`}>Link existing accounts by verified address</FieldLabel>
            <FieldDescription id={`${ids}-link-hint`}>
              When the provider has verified someone’s address and it has an account here, the two
              are linked on their first sign-in. Off, people link it themselves while signed in.
            </FieldDescription>
          </FieldContent>
        </Field>
        <Field orientation="horizontal">
          <Checkbox
            id={`${ids}-enabled`}
            checked={values.enabled}
            aria-describedby={`${ids}-enabled-hint`}
            onCheckedChange={(on) => set('enabled', on)}
          />
          <FieldContent>
            <FieldLabel htmlFor={`${ids}-enabled`}>On the sign-in page</FieldLabel>
            <FieldDescription id={`${ids}-enabled-hint`}>
              Off keeps it set up without offering it.
            </FieldDescription>
          </FieldContent>
        </Field>
        <div className="flex flex-wrap gap-2">
          {/* Busy, not gone: a button disabled under the pointer would drop focus to the
              page while the provider is being checked. */}
          <Button type="submit" disabled={busy} focusableWhenDisabled>
            {busy ? 'Checking…' : provider ? 'Save' : 'Connect'}
          </Button>
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
