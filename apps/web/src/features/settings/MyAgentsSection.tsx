/** Your own agents.
 *
 * Until this existed a personal agent was something an admin installed and then handed
 * to you. This is the member's door: name an agent, get the token it dials in with, run
 * the bridge beside it on your machine. It is yours from the first mention — it answers
 * you and whoever you lend it to with /allow, and nobody else — because the server sets
 * the owner in the same transaction that creates it.
 *
 * What it may do is not up for choosing here. The scopes are the four an answering agent
 * needs, the workspace's policy still applies, and an admin still sees it in Apps &
 * agents. The one decision that is yours is where it goes: only channels you are in are
 * offered, for the same reason an admin may not add an app somewhere they cannot read.
 */

import { useState } from 'react';
import { api, type AppChannel, type MyAgent } from '../../lib/api.ts';
import { DesktopAgentSetup } from '../admin/DesktopAgentSetup.tsx';
import type { AdminSectionProps } from '../admin/AdminConsole.tsx';
import { useAdminAction, useAdminData } from '../admin/hooks.ts';

interface Minted {
  name: string;
  botToken: string;
  signingSecret: string;
}

export function MyAgentsSection({ onError }: AdminSectionProps) {
  const { data, loading, reload } = useAdminData(
    () => api.agents.mine(),
    [],
    onError,
    'Could not load your agents.',
  );
  const act = useAdminAction(onError, reload);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [minted, setMinted] = useState<Minted | null>(null);
  const agents = data?.agents ?? [];
  const usable = name.trim().length >= 3 && !busy;

  async function attach() {
    if (!usable) return;
    setBusy(true);
    onError(null);
    try {
      const attached = await api.agents.attach(name.trim());
      setMinted({
        name: attached.agent.name,
        botToken: attached.botToken,
        signingSecret: attached.signingSecret,
      });
      setName('');
      reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'That agent could not be registered.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      <div>
        <h3 className="section-label">Connect an agent</h3>
        <p className="pref-hint" style={{ marginBottom: 10 }}>
          For an agent running on your laptop or a private network. It dials Blob, so it
          needs no public address, and it answers only you — lend it to somebody in a
          channel with <code>/allow</code>.
        </p>
        <div style={{ display: 'flex', gap: 8, maxWidth: 480 }}>
          <input
            className="input"
            value={name}
            placeholder="What is it called?"
            aria-label="Agent name"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void attach();
            }}
          />
          <button className="btn btn-primary" disabled={!usable} onClick={() => void attach()}>
            {busy ? 'Registering…' : 'Get a token'}
          </button>
        </div>
      </div>

      {minted && (
        <DesktopAgentSetup
          agentName={minted.name}
          botToken={minted.botToken}
          signingSecret={minted.signingSecret}
          bridgeHref="/api/agents/bridge"
        />
      )}

      <div>
        <h3 className="section-label">Your agents</h3>
        {loading && agents.length === 0 && <p className="pref-hint">Loading…</p>}
        {!loading && agents.length === 0 && (
          <p className="pref-hint">None yet. Connect one above and it will appear here.</p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {agents.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              onError={onError}
              onRemoved={reload}
              act={act}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function AgentRow({
  agent,
  onError,
  onRemoved,
  act,
}: {
  agent: MyAgent;
  onError: (message: string | null) => void;
  onRemoved: () => void;
  act: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const channels = useAdminData(
    () => (open ? api.agents.channels(agent.id) : Promise.resolve({ channels: [] })),
    [open, agent.id],
    onError,
    'Could not load channels.',
  );
  const channelAct = useAdminAction(onError, channels.reload);

  return (
    <div className="admin-plugin-card">
      <div className="admin-row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="admin-row-title">
            {agent.name}
            <span
              className="role-pill"
              data-muted={!agent.online}
              title={
                agent.online
                  ? 'Holding a connection to Blob'
                  : 'Not connected — run the bridge next to the agent'
              }
            >
              {agent.online ? 'connected' : 'not connected'}
            </span>
            {agent.status !== 'enabled' && (
              <span className="role-pill" data-muted>
                {agent.status.replace('_', ' ')}
              </span>
            )}
          </div>
          <div className="admin-row-meta">
            {agent.description || agent.slug} · answers you, and whoever you /allow
          </div>
        </div>
        <div className="admin-row-actions">
          <button className="btn btn-ghost" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide channels' : 'Channels'}
          </button>
          {confirming ? (
            <>
              <button
                className="btn btn-danger"
                onClick={() =>
                  void act(async () => {
                    await api.agents.detach(agent.id);
                    onRemoved();
                  })
                }
              >
                Remove {agent.name}
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </>
          ) : (
            <button className="btn btn-ghost" onClick={() => setConfirming(true)}>
              Remove
            </button>
          )}
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          <div className="pref-hint" style={{ marginBottom: 8 }}>
            Mentioning {agent.name} reaches it only in channels it has been added to. Only
            channels you are in are offered.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(channels.data?.channels ?? []).map((channel: AppChannel) => (
              <div className="pref-row" key={channel.id}>
                <div className="pref-label">#{channel.name ?? channel.id}</div>
                <button
                  className={channel.joined ? 'btn btn-ghost' : 'btn'}
                  onClick={() =>
                    void channelAct(() =>
                      channel.joined
                        ? api.agents.leaveChannel(agent.id, channel.id)
                        : api.agents.joinChannel(agent.id, channel.id),
                    )
                  }
                >
                  {channel.joined ? 'Remove' : 'Add'}
                </button>
              </div>
            ))}
            {channels.data && channels.data.channels.length === 0 && (
              <div className="pref-hint">You are not in any channel it could join.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
