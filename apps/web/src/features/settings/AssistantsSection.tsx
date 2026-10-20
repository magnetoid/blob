/** Letting your own assistant into this workspace, as you.
 *
 * The other direction from "My agents". There, an agent you run answers *inside* Blob when
 * somebody mentions it. Here, an assistant you already talk to somewhere else — Claude Code
 * in a terminal, Claude on the web, an editor — reaches *into* Blob and reads the channels
 * you can read. Blob is the MCP server; the assistant is the client.
 *
 * Two ways in. An assistant that signs in (ADR 0029) is given the connector address and
 * finds its own way to the question — Claude and ChatGPT do this — and is listed under
 * "Connected apps" once you say yes. A tool that cannot sign in takes a pasted token, the
 * older way, which stays below for exactly those.
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
import { formatEnds } from '../../lib/format.ts';
import { api, type AssistantToken } from '../../lib/api.ts';
import type { ConsoleSectionProps } from '../console/ConsoleShell.tsx';
import { Card, CardNotice } from '../console/Card.tsx';
import { ConnectedAppRow } from '../console/ConnectedAppRow.tsx';
import { useAdminAction, useAdminData } from '../console/hooks.ts';

interface Minted {
  name: string;
  secret: string;
  url: string;
  canWrite: boolean;
}

export function AssistantsSection({ onError }: ConsoleSectionProps) {
  const { data, loading, reload } = useAdminData(
    () => api.assistants.list(),
    [],
    onError,
    'Could not load your connections.',
  );
  const act = useAdminAction(onError, reload);
  const apps = useAdminData(
    () => api.oauth.grants(),
    [],
    onError,
    'Could not load your connected apps.',
  );
  const actOnApps = useAdminAction(onError, apps.reload);
  const grants = apps.data?.grants ?? [];
  const [name, setName] = useState('');
  const [canWrite, setCanWrite] = useState(false);
  const [lifetime, setLifetime] = useState<30 | 90 | 365>(90);
  const [busy, setBusy] = useState(false);
  const [minted, setMinted] = useState<Minted | null>(null);

  const tokens = data?.tokens ?? [];
  const usable = name.trim().length >= 2 && !busy;

  async function create() {
    if (!usable) return;
    setBusy(true);
    onError(null);
    try {
      const made = await api.assistants.create(name.trim(), canWrite, lifetime);
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
    <div className="console-stack">
      <ConnectorCard url={apps.data?.url ?? data?.url ?? null} />

      <Card title="Connected apps">
        {apps.loading && grants.length === 0 && <CardNotice>Loading…</CardNotice>}
        {!apps.loading && grants.length === 0 && (
          <CardNotice>
            None yet. When an assistant signs in and you say yes, it appears here — and you
            can disconnect it at any time.
          </CardNotice>
        )}
        {grants.length > 0 && (
          <div className="console-list">
            {grants.map((grant) => (
              <ConnectedAppRow
                key={grant.id}
                grant={grant}
                onDisconnect={() => void actOnApps(() => api.oauth.disconnect(grant.id))}
              />
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Connect with a token"
        description={
          <>
            For a tool that cannot sign in by itself — an editor, a script. It connects{' '}
            <strong>as you</strong>, the same as an app that signed in: your channels, your
            private conversations, nothing more. Anything it posts appears under your name.
          </>
        }
      >
        <div className="console-inline-form">
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
        <label className="pref-row">
          <span className="pref-label grow">
            Let it post
            <span className="pref-hint block">
              Off by default. A message it sends is indistinguishable from one you typed.
            </span>
          </span>
          <input
            type="checkbox"
            checked={canWrite}
            onChange={(event) => setCanWrite(event.target.checked)}
          />
        </label>
        <label className="pref-row">
          <span className="pref-label grow">
            It lasts
            <span className="pref-hint block">
              Every connection ends; make a new one when it does. Your admins can see it too.
            </span>
          </span>
          <select
            className="input"
            aria-label="How long it lasts"
            value={lifetime}
            onChange={(event) => setLifetime(Number(event.target.value) as 30 | 90 | 365)}
          >
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>A year</option>
          </select>
        </label>
      </Card>

      {minted && <AssistantSetup minted={minted} />}

      <Card title="Your tokens">
        {loading && tokens.length === 0 && <CardNotice>Loading…</CardNotice>}
        {!loading && tokens.length === 0 && (
          <CardNotice>None yet. Make one above and it will appear here.</CardNotice>
        )}
        {tokens.length > 0 && (
          <div className="console-list">
            {tokens.map((token) => (
              <TokenRow key={token.id} token={token} act={act} />
            ))}
          </div>
        )}
      </Card>
    </div>
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
    <div className="console-list-item">
      <div className="admin-row">
        <div className="grow min-0">
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
            {' · '}
            {formatEnds(token.expiresAt)}
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

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(what: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // A clipboard the browser will not give us is not worth an error: it is on screen.
    }
  }
  return { copied, copy };
}

/** The address an assistant that signs in needs, and nothing else: it finds the sign-in
 * from the endpoint's own answer, and sends the person to the question. */
function ConnectorCard({ url }: { url: string | null }) {
  const { copied, copy } = useCopy();
  // Without a header: Claude Code signs in through `/mcp` once the server is added.
  const command = url ? `claude mcp add --transport http blob ${url}` : '';

  return (
    <Card
      title="Add Blob to your assistant"
      description={
        <>
          Claude, ChatGPT and other assistants that take a custom connector sign in to Blob by
          themselves. Give them this address; they send you back here to say yes.
        </>
      }
    >
      {url && (
        <div className="connector-setup">
          <div className="draft-chip admin-secret-chip">
            <span className="admin-secret-label">Connector address</span>
            <code>{url}</code>
            <button className="btn btn-ghost" onClick={() => void copy('url', url)}>
              {copied === 'url' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="pref-hint m-0">
            <strong>In Claude or ChatGPT</strong>, add a custom connector and paste the address.
          </p>
          <p className="pref-hint m-0">
            <strong>In Claude Code</strong>, run this, then <code>/mcp</code> to sign in:
          </p>
          <pre className="admin-command-block">
            <code>{command}</code>
          </pre>
          <button className="btn btn-ghost" onClick={() => void copy('command', command)}>
            {copied === 'command' ? 'Copied' : 'Copy the command'}
          </button>
        </div>
      )}
    </Card>
  );
}

function AssistantSetup({ minted }: { minted: Minted }) {
  const { copied, copy } = useCopy();

  // The exact line Claude Code takes. `--transport http` and a header is all a remote MCP
  // server needs; the name is what the assistant will call this workspace.
  const command =
    `claude mcp add --transport http blob ${minted.url} ` +
    `--header "Authorization: Bearer ${minted.secret}"`;

  return (
    <div className="admin-secret-card block">
      <div className="admin-row-title">Point “{minted.name}” at this workspace</div>
      <div className="admin-row-meta">
        This token is shown once. Only its fingerprint is stored, so if you lose it, revoke
        this connection and make another.
      </div>

      <p className="pref-hint m-0">
        <strong>In a terminal</strong>, for Claude Code:
      </p>
      <pre className="admin-command-block">
        <code>{command}</code>
      </pre>
      <button className="btn btn-ghost" onClick={() => void copy('command', command)}>
        {copied === 'command' ? 'Copied' : 'Copy the command'}
      </button>

      <p className="pref-hint m-0">
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

      <p className="pref-hint m-0">
        Once it is connected, ask it something like “what happened in #general today?” or
        “find the thread about the deploy”.{' '}
        {minted.canWrite
          ? 'It can also post — and everyone will read that as you writing it.'
          : 'It cannot post: this connection reads only.'}
      </p>
    </div>
  );
}
