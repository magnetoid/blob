/** Single sign-on providers — the server administrator's (ADR 0033).
 *
 * A provider is the server's, not a workspace's: one address is one person across every
 * workspace here, so whoever vouches for them does so everywhere. The page says the one
 * address to register at the provider, and never shows a client secret back — only
 * whether one is set.
 */

import { useState, type FormEvent } from 'react';
import {
  api,
  ApiError,
  type InstanceWorkspace,
  type SsoProvider,
  type SsoProviderInput,
} from '../../../lib/api.ts';
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx';
import { DialogPresence } from '../../../components/Dialog.tsx';
import type { ConsoleSectionProps } from '../../console/ConsoleShell.tsx';
import { Card, CardNotice } from '../../console/Card.tsx';
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
    <div className="console-stack">
      <Card
        title="How it works"
        description="People sign in with the account their organisation already gives them — Google Workspace, Microsoft Entra, Okta, Keycloak, anything that speaks OpenID Connect."
      >
        <p className="pref-hint">
          Register this one address at the provider as the redirect (callback) address, then connect
          it below with the client id and secret the provider gives you.
        </p>
        {data && (
          <div className="draft-chip console-copy">
            <span className="grow ellipsis">{data.callbackUrl}</span>
            <button
              className="btn btn-ghost"
              onClick={() => void navigator.clipboard.writeText(data.callbackUrl)}
            >
              Copy
            </button>
          </div>
        )}
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
                <button
                  className="btn"
                  onClick={() =>
                    void api.admin
                      .checkSso(provider.id)
                      .then((answer) => setChecked((all) => ({ ...all, [provider.id]: answer })))
                      .catch((err: unknown) => onError(failure(err)))
                  }
                >
                  Check
                </button>
                <button className="btn" onClick={() => setEditing(provider)}>
                  Edit
                </button>
                <button className="btn btn-ghost" onClick={() => setRemoving(provider)}>
                  Remove
                </button>
              </>
            }
          >
            {!provider.enabled && (
              <CardNotice>Switched off: its button is not on the sign-in page.</CardNotice>
            )}
            {checked[provider.id] && (
              <p className={checked[provider.id]?.ok ? 'pref-hint' : 'error-text'} role="status">
                {checked[provider.id]?.message}
              </p>
            )}
            <div className="pref-row">
              <div className="grow min-0">
                <div className="pref-label">Signs in</div>
                <div className="pref-hint">
                  {provider.linked === 1 ? '1 person' : `${provider.linked} people`} ·{' '}
                  {provider.allowedDomains.length > 0
                    ? `addresses at ${provider.allowedDomains.join(', ')}`
                    : 'any address'}{' '}
                  ·{' '}
                  {provider.linkByEmail
                    ? 'links existing accounts by verified address'
                    : 'people link it themselves'}
                </div>
              </div>
            </div>
            <div className="pref-row">
              <div className="grow min-0">
                <div className="pref-label">New people</div>
                <div className="pref-hint">
                  {provider.joinWorkspaceId
                    ? `Join ${spaces.find((w) => w.id === provider.joinWorkspaceId)?.name ?? 'a workspace'} as members`
                    : 'Need an invitation'}
                </div>
              </div>
            </div>
            <div className="pref-row">
              <div className="grow min-0">
                <div className="pref-label">Client</div>
                <div className="pref-hint">
                  {provider.clientId} ·{' '}
                  {provider.hasSecret ? 'secret set' : 'no secret (public client)'} · button name “
                  {provider.slug}”
                </div>
              </div>
            </div>
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const field = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement).value.trim();
    const checked = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).checked;
    const input: SsoProviderInput = {
      name: field('name'),
      issuer: field('issuer'),
      clientId: field('clientId'),
      clientSecret: field('clientSecret') || undefined,
      scopes: field('scopes') || 'openid email profile',
      allowedDomains: field('allowedDomains')
        .split(/[\s,]+/)
        .filter(Boolean),
      linkByEmail: checked('linkByEmail'),
      joinWorkspaceId: field('joinWorkspaceId') || null,
      enabled: checked('enabled'),
    };
    onError(null);
    setBusy(true);
    try {
      if (provider) await api.admin.updateSso(provider.id, input);
      else {
        await api.admin.createSso({ ...input, slug: field('slug') });
        form.reset();
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
      <form className="console-form" onSubmit={(event) => void submit(event)}>
        <div className="console-form-grid">
          <label className="field">
            <span className="field-label">Button name</span>
            <input
              className="input"
              name="name"
              defaultValue={provider?.name}
              placeholder="Acme"
              maxLength={60}
              required
            />
          </label>
          {!provider && (
            <label className="field">
              <span className="field-label">Short name</span>
              <input
                className="input"
                name="slug"
                placeholder="acme"
                pattern="[a-z0-9][a-z0-9\-]{1,30}"
                title="Lowercase letters, numbers and hyphens"
                required
              />
            </label>
          )}
          <label className="field">
            <span className="field-label">Issuer</span>
            <input
              className="input"
              name="issuer"
              type="url"
              defaultValue={provider?.issuer}
              placeholder="https://accounts.google.com"
              spellCheck={false}
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Client id</span>
            <input
              className="input"
              name="clientId"
              defaultValue={provider?.clientId}
              spellCheck={false}
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Client secret</span>
            <input
              className="input"
              name="clientSecret"
              type="password"
              autoComplete="off"
              placeholder={provider?.hasSecret ? 'Set — leave blank to keep' : ''}
            />
          </label>
          <label className="field">
            <span className="field-label">Scopes</span>
            <input
              className="input"
              name="scopes"
              defaultValue={provider?.scopes ?? 'openid email profile'}
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span className="field-label">Only these domains</span>
            <input
              className="input"
              name="allowedDomains"
              defaultValue={provider?.allowedDomains.join(', ')}
              placeholder="acme.com, acme.co.uk"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span className="field-label">New people</span>
            <select
              className="input"
              name="joinWorkspaceId"
              defaultValue={provider?.joinWorkspaceId ?? ''}
            >
              <option value="">Need an invitation</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  Join {workspace.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="pref-hint">
          With no domains named, anyone the provider has verified may sign in to an account that
          already exists here. Letting new people join without an invitation needs the domains
          named — otherwise anyone with an account at the provider could.
        </p>
        <label className="pref-row">
          <span className="pref-label grow">
            Link existing accounts by verified address
            <span className="pref-hint block">
              When the provider has verified someone’s address and it has an account here, the two
              are linked on their first sign-in. Off, people link it themselves while signed in.
            </span>
          </span>
          <input
            type="checkbox"
            name="linkByEmail"
            defaultChecked={provider?.linkByEmail ?? true}
          />
        </label>
        <label className="pref-row">
          <span className="pref-label grow">
            On the sign-in page
            <span className="pref-hint block">Off keeps it set up without offering it.</span>
          </span>
          <input type="checkbox" name="enabled" defaultChecked={provider?.enabled ?? true} />
        </label>
        <div className="console-form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Checking…' : provider ? 'Save' : 'Connect'}
          </button>
          {onCancel && (
            <button className="btn btn-ghost" type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </Card>
  );
}
