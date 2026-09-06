/** Letting your own assistant into this workspace, as you.
 *
 * The other direction from "My agents". There, an agent you run answers *inside* Blob when
 * somebody mentions it. Here, an assistant you already talk to somewhere else — Claude Code
 * in a terminal, Claude on the web, an editor — reaches *into* Blob and reads the channels
 * you can read. Blob is the MCP server; the assistant is the client.
 *
 * Two things this screen has to get across, because both are surprising the first time.
 *
 * **It is you.** Not a bot with its own membership: whatever you can see, it can see, and
 * anything it posts appears under your name in front of your colleagues. That is why the
 * write half is a separate tick rather than the default, and why revoking is one click.
 *
 * **The token is shown once.** Only its hash is stored, so a person who closes this panel
 * without copying it has to mint another. The command block is therefore the token already
 * substituted in — a placeholder to fill in by hand is the step people get wrong.
 */

import { useState } from 'react';
import { api, type AssistantToken } from '../../lib/api.ts';
import type { AdminSectionProps } from '../admin/AdminConsole.tsx';
import { useAdminAction, useAdminData } from '../admin/hooks.ts';

interface Minted {
  name: string;
  secret: string;
  url: string;
  canWrite: boolean;
}

export function AssistantsSection({ onError }: AdminSectionProps) {
  const { data, loading, reload } = useAdminData(
    () => api.assistants.list(),
    [],
    onError,
    'Could not load your connections.',
  );
  const act = useAdminAction(onError, reload);
  const [name, setName] = useState('');
  const [canWrite, setCanWrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [minted, setMinted] = useState<Minted | null>(null);

  const tokens = data?.tokens ?? [];
  const usable = name.trim().length >= 2 && !busy;

  async function create() {
    if (!usable) return;
    setBusy(true);
    onError(null);
    try {
      const made = await api.assistants.create(name.trim(), canWrite);
      setMinted({
        name: made.token.name,
        secret: made.secret,
        url: made.url,
        canWrite: made.token.scopes.includes('write'),
      });
      setName('');
      setCanWrite(false);
      reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'That connection could not be made.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      <div>
        <h3 className="section-label">Connect an assistant</h3>
        <p className="pref-hint" style={{ marginBottom: 10 }}>
          Give an assistant you already use — Claude Code, Claude on the web, your editor —
          a way to read this workspace. It connects <strong>as you</strong>: the same
          channels, the same private conversations, nothing more. Anything it posts appears
          under your name.
        </p>
        <div style={{ display: 'flex', gap: 8, maxWidth: 480 }}>
          <input
            className="input"
            value={name}
            placeholder="What is it? “Claude Code on the laptop”"
            aria-label="Connection name"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create();
            }}
          />
          <button className="btn btn-primary" disabled={!usable} onClick={() => void create()}>
            {busy ? 'Connecting…' : 'Get a token'}
          </button>
        </div>
        <label className="pref-row" style={{ maxWidth: 480, marginTop: 10 }}>
          <span className="pref-label">
            Let it post
            <span className="pref-hint" style={{ display: 'block' }}>
              Off by default. A message it sends is indistinguishable from one you typed.
            </span>
          </span>
          <input
            type="checkbox"
            checked={canWrite}
            onChange={(event) => setCanWrite(event.target.checked)}
          />
        </label>
      </div>

      {minted && <AssistantSetup minted={minted} />}

      <div>
        <h3 className="section-label">Your connections</h3>
        {loading && tokens.length === 0 && <p className="pref-hint">Loading…</p>}
        {!loading && tokens.length === 0 && (
          <p className="pref-hint">None yet. Connect one above and it will appear here.</p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tokens.map((token) => (
            <TokenRow key={token.id} token={token} act={act} />
          ))}
        </div>
      </div>
    </section>
  );
}

function TokenRow({
  token,
  act,
}: {
  token: AssistantToken;
  act: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const writes = token.scopes.includes('write');

  return (
    <div className="admin-plugin-card">
      <div className="admin-row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="admin-row-title">
            {token.name}
            <span className="role-pill" data-muted={!writes}>
              {writes ? 'reads and posts' : 'reads only'}
            </span>
          </div>
          <div className="admin-row-meta">
            {token.lastUsedAt
              ? `Last used ${new Date(token.lastUsedAt).toLocaleString()}`
              : 'Never used — it has not connected yet'}
          </div>
        </div>
        <div className="admin-row-actions">
          {confirming ? (
            <>
              <button
                className="btn btn-danger"
                onClick={() => void act(() => api.assistants.revoke(token.id))}
              >
                Revoke {token.name}
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </>
          ) : (
            <button className="btn btn-ghost" onClick={() => setConfirming(true)}>
              Revoke
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AssistantSetup({ minted }: { minted: Minted }) {
  const [copied, setCopied] = useState<string | null>(null);

  // The exact line Claude Code takes. `--transport http` and a header is all a remote MCP
  // server needs; the name is what the assistant will call this workspace.
  const command =
    `claude mcp add --transport http blob ${minted.url} ` +
    `--header "Authorization: Bearer ${minted.secret}"`;

  async function copy(what: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // A clipboard the browser will not give us is not worth an error: it is on screen.
    }
  }

  return (
    <div className="admin-secret-card" style={{ display: 'block' }}>
      <div className="admin-row-title">Point “{minted.name}” at this workspace</div>
      <div className="admin-row-meta" style={{ marginBottom: 12 }}>
        This token is shown once. Only its fingerprint is stored, so if you lose it, revoke
        this connection and make another.
      </div>

      <p className="pref-hint" style={{ margin: '0 0 6px' }}>
        <strong>In a terminal</strong>, for Claude Code:
      </p>
      <pre className="admin-command-block">
        <code>{command}</code>
      </pre>
      <button className="btn btn-ghost" onClick={() => void copy('command', command)}>
        {copied === 'command' ? 'Copied' : 'Copy the command'}
      </button>

      <p className="pref-hint" style={{ margin: '16px 0 6px' }}>
        <strong>Anywhere else</strong> that takes a remote MCP server — Claude on the web,
        an editor — give it these two:
      </p>
      <div className="draft-chip admin-secret-chip">
        <span className="admin-secret-label">Server URL</span>
        <code>{minted.url}</code>
        <button className="btn btn-ghost" onClick={() => void copy('url', minted.url)}>
          {copied === 'url' ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="draft-chip admin-secret-chip">
        <span className="admin-secret-label">Authorization</span>
        <code>Bearer {minted.secret}</code>
        <button
          className="btn btn-ghost"
          onClick={() => void copy('token', `Bearer ${minted.secret}`)}
        >
          {copied === 'token' ? 'Copied' : 'Copy'}
        </button>
      </div>

      <p className="pref-hint" style={{ margin: '14px 0 0' }}>
        Once it is connected, ask it something like “what happened in #general today?” or
        “find the thread about the deploy”.{' '}
        {minted.canWrite
          ? 'It can also post — and everyone will read that as you writing it.'
          : 'It cannot post: this connection reads only.'}
      </p>
    </div>
  );
}
