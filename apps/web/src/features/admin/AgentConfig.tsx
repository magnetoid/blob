/** What a hosted agent is configured with, and how to change it.
 *
 * The declarative half of setting an agent up: the values it needs to work — a model
 * name, a provider key, a timeout. The other half is the terminal, and the split is by
 * what the operation actually *is* rather than by taste. A key is a field. A device-code
 * login prints a URL, waits, and completes out of band; no arrangement of text inputs
 * expresses that.
 *
 * Two things here are load-bearing rather than decorative:
 *
 * **Secrets are described, not printed.** A key comes back as "73 characters, ending
 * a4f2" — enough to tell the key you pasted from the one that is still empty, which is
 * the question anyone opening this screen is actually asking. This is hygiene rather than
 * a boundary: the same admin can read the real value through the terminal. What it buys
 * is that a console left open or screen-shared does not have an API key on it.
 *
 * **A duplicated key is shown, loudly.** The runner's environment API appends rather than
 * upserts, so a key can exist twice with two different values and Docker will take one of
 * them without saying which. That is not hypothetical — it is why an agent here spent
 * days failing to authenticate against a key the dashboard displayed as correct. Saving
 * repairs it, because a write deletes every row for the key before creating one.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type AgentEnvVar } from '../../lib/api.ts';

interface Props {
  pluginId: string;
  onError: (message: string | null) => void;
}

export function AgentConfig({ pluginId, onError }: Props) {
  const [rows, setRows] = useState<AgentEnvVar[] | null>(null);
  const [reserved, setReserved] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<string[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const fail = useCallback(
    (err: unknown, fallback: string) => onError(err instanceof ApiError ? err.message : fallback),
    [onError],
  );

  const apply = useCallback((next: { env: AgentEnvVar[]; reserved: string[] }) => {
    setRows(next.env);
    setReserved(next.reserved);
    setEdits({});
    setRemoving([]);
    setNewKey('');
    setNewValue('');
  }, []);

  useEffect(() => {
    let current = true;
    api.admin
      .agentEnv(pluginId)
      .then((next) => {
        if (current) apply(next);
      })
      .catch((err: unknown) => {
        if (current) fail(err, 'Could not read this agent’s configuration.');
      });
    return () => {
      current = false;
    };
  }, [pluginId, apply, fail]);

  const duplicates = [...new Set((rows ?? []).filter((r) => r.duplicated).map((r) => r.key))];
  const pending =
    Object.keys(edits).length > 0 || removing.length > 0 || (newKey.trim() && newValue.trim());

  async function save(restart: boolean) {
    if (busy) return;
    setBusy(true);
    onError(null);
    const set = { ...edits };
    if (newKey.trim() && newValue.trim()) set[newKey.trim().toUpperCase()] = newValue;
    try {
      apply(await api.admin.saveAgentEnv(pluginId, { set, remove: removing, restart }));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      fail(err, 'Those values could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  if (rows === null) return <div className="admin-row-meta">Reading configuration…</div>;

  // One row per key, not per stored row: a duplicated key is one thing to fix, and
  // showing it twice would invite editing each copy separately — which is how it got
  // this way.
  const byKey = new Map<string, AgentEnvVar>();
  for (const row of rows) if (!byKey.has(row.key)) byKey.set(row.key, row);

  return (
    <div className="agent-config">
      {duplicates.length > 0 && (
        <div className="admin-row-meta agent-config-warning">
          <strong>Set twice: {duplicates.join(', ')}.</strong> The runner stores each of
          these more than once, and the container uses one of them without saying which —
          so the agent may be running on a value this screen is not showing. Saving the key
          fixes it.
        </div>
      )}

      <table className="agent-config-table">
        <tbody>
          {[...byKey.values()].map((row) => {
            const gone = removing.includes(row.key);
            return (
              <tr key={row.key} data-removed={gone ? 'true' : undefined}>
                <td className="agent-config-key">
                  <code>{row.key}</code>
                  {row.duplicated && <span className="role-pill">set twice</span>}
                  {row.managed && <span className="role-pill" data-muted="true">runner</span>}
                </td>
                <td>
                  {row.managed ? (
                    // Editable in principle and pointless in practice: the runner rewrites
                    // these on every deploy, so an edit here disappears without failing.
                    <span className="admin-row-meta">{row.value ?? row.hint}</span>
                  ) : (
                    <input
                      className="input"
                      type={row.secret ? 'password' : 'text'}
                      disabled={gone}
                      placeholder={row.secret ? (row.hint ?? 'not set') : ''}
                      value={edits[row.key] ?? (row.secret ? '' : (row.value ?? ''))}
                      onChange={(event) =>
                        setEdits((prev) => ({ ...prev, [row.key]: event.target.value }))
                      }
                    />
                  )}
                </td>
                <td className="agent-config-actions">
                  {!row.managed && (
                    <button
                      className="btn btn-ghost"
                      onClick={() =>
                        setRemoving((prev) =>
                          gone ? prev.filter((k) => k !== row.key) : [...prev, row.key],
                        )
                      }
                    >
                      {gone ? 'Keep' : 'Remove'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="agent-config-add">
        <input
          className="input"
          placeholder="NEW_KEY"
          value={newKey}
          spellCheck={false}
          onChange={(event) => setNewKey(event.target.value)}
        />
        <input
          className="input"
          placeholder="value"
          value={newValue}
          onChange={(event) => setNewValue(event.target.value)}
        />
      </div>

      <div className="chip-row" style={{ marginTop: 12 }}>
        <button className="btn" disabled={busy || !pending} onClick={() => void save(true)}>
          Save and restart
        </button>
        <button
          className="btn btn-ghost"
          disabled={busy || !pending}
          onClick={() => void save(false)}
        >
          Save only
        </button>
        {saved && <span className="copied-note">Saved</span>}
      </div>

      <p className="pref-hint" style={{ margin: '10px 0 0' }}>
        {/* Said plainly because the alternative is an operator staring at a value the
            agent does not have and concluding the save did not work. */}
        Configuration only reaches the container when it starts, so a change is not live
        until you restart it. {reserved.length > 0 && `Blob sets ${reserved.join(', ')} itself.`}
      </p>
    </div>
  );
}
