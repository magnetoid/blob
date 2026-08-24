/** Connecting an agent that runs somewhere Blob cannot reach.
 *
 * The other two ways of adding an agent both end with an address: paste a URL, or paste
 * a repository and let the runner produce one. Neither works for the agent on your own
 * machine — there is no hostname to give, no certificate, and no route in through your
 * router. This one inverts it: Blob mints a token, the agent dials in with it and holds
 * the connection, and runs are written down that pipe.
 *
 * So this form registers an agent that does not exist yet. What you get back is a token,
 * and the agent becomes real the moment something connects with it. That is also the
 * whole of "importing" one — it announces its own name and description on the way in,
 * rather than being described by hand here.
 */

import { useState } from 'react';
import { api, ApiError } from '../../lib/api.ts';

interface Props {
  scopeCatalog: Record<string, string>;
  onConnected: (name: string, botToken: string) => void;
  onError: (message: string | null) => void;
}

/** What an agent answering mentions actually needs, and nothing beyond it. */
const DEFAULT_SCOPES = ['messages:read', 'messages:write', 'channels:read', 'channels:join'];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function ConnectAgentForm({ scopeCatalog, onConnected, onError }: Props) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(DEFAULT_SCOPES);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const slug = slugify(name);
  // Three characters is the server's minimum, and failing here beats a 400 that lands
  // after someone has already picked scopes.
  const usable = slug.length >= 3 && !busy;

  async function submit() {
    if (!usable) return;
    setBusy(true);
    onError(null);
    try {
      const installed = await api.admin.installPlugin({
        slug,
        name: name.trim(),
        runtime: 'socket',
        version: '1.0.0',
        events: [],
        scopes,
      });
      onConnected(installed.plugin.name, installed.botToken);
      setName('');
      setScopes(DEFAULT_SCOPES);
      setOpen(false);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'That agent could not be registered.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="admin-app-form">
        <button className="btn btn-ghost" onClick={() => setOpen(true)}>
          Connect an agent on your machine
        </button>
        <p className="muted admin-form-hint">
          For an agent running on your laptop or a private network. It dials Blob, so it
          needs no public address.
        </p>
      </div>
    );
  }

  return (
    <div className="admin-app-form">
      <h4>Connect an agent on your machine</h4>
      <p className="muted admin-form-hint">
        Blob gives you a token. Your agent opens a WebSocket to{' '}
        <code>{location.origin.replace(/^http/, 'ws')}/ws/agent</code> with it, and says
        what it is when it connects.
      </p>

      <label className="field">
        <span className="field-label">What is it called?</span>
        <input
          className="input"
          value={name}
          autoFocus
          placeholder="Desktop Claude"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
          }}
        />
        {slug && (
          <span className="muted admin-form-hint">
            Known as <code>{slug}</code>, which cannot change later.
          </span>
        )}
      </label>

      <fieldset className="admin-scope-list">
        <legend className="field-label">What may it do?</legend>
        {Object.entries(scopeCatalog).map(([scope, description]) => (
          <label key={scope} className="admin-scope-row">
            <input
              type="checkbox"
              checked={scopes.includes(scope)}
              onChange={() =>
                setScopes((current) =>
                  current.includes(scope)
                    ? current.filter((s) => s !== scope)
                    : [...current, scope],
                )
              }
            />
            <span>
              <code>{scope}</code> — {description}
            </span>
          </label>
        ))}
      </fieldset>
      <p className="muted admin-form-hint">
        An agent cannot widen this by asking on connect. Changing it later goes through
        the same approval an app update does.
      </p>

      <div className="admin-form-actions">
        <button className="btn btn-primary" disabled={!usable} onClick={() => void submit()}>
          {busy ? 'Registering…' : 'Get a token'}
        </button>
        <button className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
