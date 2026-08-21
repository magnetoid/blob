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

export function DeployAgentForm({ scopeCatalog, onInstalled, onError }: Props) {
  const [repoUrl, setRepoUrl] = useState('');
  const [ref, setRef] = useState('main');
  const [preview, setPreview] = useState<AgentRepoPreview | null>(null);
  const [busy, setBusy] = useState(false);

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
      const installed = await api.admin.installFromRepo({
        repoUrl: preview.repoUrl,
        ref: preview.ref,
      });
      onInstalled(installed.plugin.name, installed.signingSecret, installed.botToken);
      setPreview(null);
      setRepoUrl('');
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
