/** Installing an agent by pasting where its code lives.
 *
 * Two steps on purpose. Reading the manifest and approving what it asks for are
 * separated, because the scopes are the decision being made — an agent installed without
 * anyone reading them is the failure this screen exists to prevent.
 */

import { useState } from 'react';
import { api, ApiError, type AgentRepoPreview } from '../../lib/api.ts';

interface Props {
  scopeCatalog: Record<string, string>;
  onInstalled: (name: string, signingSecret: string, botToken: string) => void;
  onError: (message: string | null) => void;
}

/** One row of the configuration table. `id` only exists to key the list while editing. */
interface EnvRow {
  id: number;
  key: string;
  value: string;
}

export function DeployAgentForm({ scopeCatalog, onInstalled, onError }: Props) {
  const [repoUrl, setRepoUrl] = useState('');
  const [ref, setRef] = useState('main');
  const [preview, setPreview] = useState<AgentRepoPreview | null>(null);
  const [env, setEnv] = useState<EnvRow[]>([]);
  const [busy, setBusy] = useState(false);

  function setRow(id: number, patch: Partial<EnvRow>) {
    setEnv((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function fail(err: unknown, fallback: string) {
    onError(err instanceof ApiError ? err.message : fallback);
  }

  async function read() {
    if (!repoUrl.trim() || busy) return;
    setBusy(true);
    onError(null);
    try {
      setPreview(await api.admin.previewRepo({ repoUrl: repoUrl.trim(), ref: ref.trim() }));
    } catch (err) {
      setPreview(null);
      fail(err, 'That repository could not be read.');
    } finally {
      setBusy(false);
    }
  }

  async function install() {
    if (!preview || busy) return;
    setBusy(true);
    onError(null);
    try {
      const supplied = Object.fromEntries(
        env
          .map((row) => [row.key.trim(), row.value] as const)
          .filter(([key, value]) => key && value),
      );
      const installed = await api.admin.installFromRepo({
        repoUrl: preview.repoUrl,
        ref: preview.ref,
        env: Object.keys(supplied).length > 0 ? supplied : undefined,
      });
      onInstalled(installed.plugin.name, installed.signingSecret, installed.botToken);
      setPreview(null);
      setRepoUrl('');
      setEnv([]);
    } catch (err) {
      fail(err, 'That agent could not be deployed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-app-form">
      <div className="admin-row-title">Deploy an agent from a repository</div>
      <p className="pref-hint" style={{ margin: '4px 0 12px' }}>
        The repository needs a <code>blob-app.json</code> at its root. It runs in its own
        container and reaches the workspace only through the API, with the scopes you
        approve below.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: 1 }}>
          <span className="field-label">Repository</span>
          <input
            className="input"
            value={repoUrl}
            placeholder="https://github.com/you/your-agent"
            onChange={(event) => {
              setRepoUrl(event.target.value);
              // The preview describes the old URL the moment this changes.
              setPreview(null);
            }}
          />
        </label>
        <label className="field" style={{ width: 130 }}>
          <span className="field-label">Branch or tag</span>
          <input
            className="input"
            value={ref}
            onChange={(event) => {
              setRef(event.target.value);
              setPreview(null);
            }}
          />
        </label>
        <button
          className="btn"
          style={{ marginBottom: 2 }}
          onClick={() => void read()}
          disabled={!repoUrl.trim() || busy}
        >
          {busy && !preview ? 'Reading…' : 'Read manifest'}
        </button>
      </div>

      {preview && (
        <div className="agent-preview">
          <div className="admin-row-title">
            {preview.name}
            <span className="role-pill">{preview.version}</span>
            <span className="role-pill" data-muted>
              {preview.build}
            </span>
          </div>
          {preview.description && (
            <p className="pref-hint" style={{ margin: '4px 0 0' }}>
              {preview.description}
            </p>
          )}

          <h3 className="section-label" style={{ paddingLeft: 0, marginTop: 14 }}>
            It is asking for
          </h3>
          {preview.scopes.length === 0 ? (
            <p className="pref-hint">No permissions at all.</p>
          ) : (
            <ul className="agent-scopes">
              {preview.scopes.map((scope) => (
                <li key={scope}>
                  <code>{scope}</code>
                  <span>{scopeCatalog[scope] ?? 'Unknown permission'}</span>
                </li>
              ))}
            </ul>
          )}

          {preview.events.length > 0 && (
            <p className="pref-hint" style={{ marginTop: 10 }}>
              Receives: {preview.events.join(', ')}
            </p>
          )}

          <h3 className="section-label" style={{ paddingLeft: 0, marginTop: 16 }}>
            Configuration
          </h3>
          <p className="pref-hint" style={{ margin: '0 0 10px' }}>
            Anything the agent needs that this workspace cannot know — a model provider&rsquo;s
            API key, usually. It goes to the container and is not stored here, so a redeploy
            keeps it but nothing else can read it back.
          </p>

          {env.map((row) => (
            <div key={row.id} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                value={row.key}
                placeholder="ANTHROPIC_API_KEY"
                aria-label="Variable name"
                onChange={(event) => setRow(row.id, { key: event.target.value })}
              />
              <input
                className="input"
                style={{ flex: 1 }}
                type="password"
                value={row.value}
                placeholder="value"
                aria-label={`Value for ${row.key || 'the variable'}`}
                onChange={(event) => setRow(row.id, { value: event.target.value })}
              />
              <button
                className="btn btn-ghost"
                aria-label={`Remove ${row.key || 'this variable'}`}
                onClick={() => setEnv((rows) => rows.filter((r) => r.id !== row.id))}
              >
                Remove
              </button>
            </div>
          ))}

          <button
            className="btn btn-ghost"
            onClick={() => setEnv((rows) => [...rows, { id: Date.now(), key: '', value: '' }])}
          >
            Add a variable
          </button>

          <div className="dialog-actions" style={{ justifyContent: 'flex-start', marginTop: 14 }}>
            <button className="btn btn-primary" onClick={() => void install()} disabled={busy}>
              {busy ? 'Deploying…' : 'Approve and deploy'}
            </button>
            <button className="btn" onClick={() => setPreview(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
