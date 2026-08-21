/**
 * The superadmin console.
 *
 * Five sections in one scrolling pane, matching the Preferences layout. Only admins and
 * the owner can reach it — the rail item is hidden for everyone else, and the API
 * refuses with 403 regardless.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  ApiError,
  type AdminChannel,
  type AdminHealth,
  type AdminInvite,
  type AdminPlugin,
  type AdminPluginCatalog,
  type AdminPluginDelivery,
  type AdminUser,
  type AdminWebhook,
  type AuditEvent,
} from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { Avatar } from '../../components/Avatar.tsx';
import { SearchIcon } from '../../components/Icon.tsx';
import { formatRelative } from '../messages/MessageRow.tsx';
import { navigate, type AdminSection } from '../../lib/router.ts';
import { AgentDeployment } from './AgentDeployment.tsx';
import { DeployAgentForm } from './DeployAgentForm.tsx';
import { FeedbackSection } from './FeedbackSection.tsx';
import { ThemesSection } from './ThemesSection.tsx';

type Section = AdminSection;

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'people', label: 'People' },
  { id: 'invitations', label: 'Invitations' },
  { id: 'channels', label: 'Channels' },
  { id: 'apps', label: 'Apps' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'themes', label: 'Themes' },
  { id: 'audit', label: 'Audit log' },
  { id: 'settings', label: 'Settings' },
];

/** Turns `user.role_changed` into "Role changed". */
function humanizeAction(action: string): string {
  const [, verb] = action.split('.');
  const words = (verb ?? action).replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function AdminView({ section }: { section: Section }) {
  const currentUser = useStore((s) => s.currentUser);
  const [error, setError] = useState<string | null>(null);

  const isOwner = currentUser?.role === 'owner';

  // The section is the URL now, so an error from the section you just left would follow
  // you into the next one — including when the Back button is what moved you. Adjusting
  // during render rather than in an effect avoids the extra pass.
  const [errorSection, setErrorSection] = useState(section);
  if (errorSection !== section) {
    setErrorSection(section);
    setError(null);
  }

  return (
    <div className="pane">
      <div style={{ overflowY: 'auto' }}>
        <div style={{ maxWidth: 860, padding: '44px 26px 60px' }}>
          <h1
            style={{
              margin: 0,
              fontSize: 'var(--text-xl)',
              fontWeight: 600,
              letterSpacing: '-0.02em',
            }}
          >
            Administration
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 'var(--text-row)', color: 'var(--text-4)' }}>
            {isOwner
              ? 'You own this workspace.'
              : 'You are an admin. Only the owner can change roles.'}
          </p>

          <div className="chip-row" style={{ marginTop: 24 }}>
            {SECTIONS.map((entry) => (
              <button
                key={entry.id}
                className="chip"
                aria-pressed={section === entry.id}
                onClick={() => navigate(`/admin/${entry.id}`)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {error && (
            <p className="error-text" style={{ marginTop: 16 }}>
              {error}
            </p>
          )}

          <div style={{ marginTop: 26 }}>
            {section === 'people' && <PeopleSection isOwner={isOwner} onError={setError} />}
            {section === 'invitations' && <InvitationsSection onError={setError} />}
            {section === 'channels' && <ChannelsSection onError={setError} />}
            {section === 'apps' && <AppsSection onError={setError} />}
            {section === 'feedback' && <FeedbackSection onError={setError} />}
            {section === 'themes' && <ThemesSection onError={setError} />}
            {section === 'audit' && <AuditSection />}
            {section === 'settings' && <SettingsSection onError={setError} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Wraps an admin action so failures surface as a message rather than a dead click. */
function useAdminAction(onError: (message: string | null) => void, reload: () => void) {
  return useCallback(
    async (run: () => Promise<unknown>) => {
      onError(null);
      try {
        await run();
        reload();
      } catch (err) {
        onError(err instanceof ApiError ? err.message : 'That did not work.');
      }
    },
    [onError, reload],
  );
}

function PeopleSection({
  isOwner,
  onError,
}: {
  isOwner: boolean;
  onError: (message: string | null) => void;
}) {
  const currentUser = useStore((s) => s.currentUser);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    void api.admin
      .users({ q: query || undefined })
      .then((r) => setUsers(r.users))
      .catch(() => onError('Could not load the directory.'))
      .finally(() => setLoading(false));
  }, [query, onError]);

  useEffect(() => {
    const timer = setTimeout(load, query ? 220 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  const act = useAdminAction(onError, load);

  return (
    <section>
      <div className="search-field" style={{ maxWidth: 320, marginBottom: 18 }}>
        <SearchIcon size={16} strokeWidth={1.8} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email"
          aria-label="Search people"
        />
      </div>

      {loading && users.length === 0 ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="admin-table" role="table">
          {users.map((user) => (
            <div
              className="admin-row"
              role="row"
              key={user.id}
              data-inactive={user.deactivatedAt !== null}
            >
              <Avatar user={{ displayName: user.displayName, avatarUrl: null }} size="lg" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="admin-row-title">
                  {user.displayName}
                  {user.role !== 'member' && <span className="role-pill">{user.role}</span>}
                  {user.deactivatedAt && <span className="role-pill" data-muted>deactivated</span>}
                </div>
                <div className="admin-row-meta">
                  {user.email} · {user.messageCount} messages · {user.channelCount} channels
                  {user.lastSeenAt ? ` · seen ${formatRelative(user.lastSeenAt)}` : ' · never seen'}
                </div>
              </div>

              <div className="admin-row-actions">
                {isOwner && user.id !== currentUser?.id && !user.deactivatedAt && (
                  <select
                    className="chip"
                    value={user.role}
                    aria-label={`Role for ${user.displayName}`}
                    onChange={(e) =>
                      void act(() =>
                        api.admin.setRole(user.id, e.target.value as 'member' | 'admin' | 'owner'),
                      )
                    }
                  >
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                    <option value="owner">owner</option>
                  </select>
                )}
                {!user.deactivatedAt && user.sessionCount > 0 && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => void act(() => api.admin.revokeSessions(user.id))}
                    title={`Sign out of ${user.sessionCount} session(s)`}
                  >
                    Sign out
                  </button>
                )}
                {user.deactivatedAt ? (
                  <button
                    className="btn"
                    onClick={() => void act(() => api.admin.reactivate(user.id))}
                  >
                    Reactivate
                  </button>
                ) : (
                  user.role !== 'owner' &&
                  user.id !== currentUser?.id && (
                    <button
                      className="btn"
                      onClick={() => {
                        if (confirm(`Deactivate ${user.displayName}?`)) {
                          void act(() => api.admin.deactivate(user.id));
                        }
                      }}
                    >
                      Deactivate
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
          {users.length === 0 && <p className="muted">Nobody matched “{query}”.</p>}
        </div>
      )}
    </section>
  );
}

function InvitationsSection({ onError }: { onError: (message: string | null) => void }) {
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [link, setLink] = useState<string | null>(null);

  const load = useCallback(() => {
    void api.admin
      .invites()
      .then((r) => setInvites(r.invites))
      .catch(() => onError('Could not load invitations.'));
  }, [onError]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);
  const act = useAdminAction(onError, load);

  return (
    <section>
      <form
        style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 20 }}
        onSubmit={(event) => {
          event.preventDefault();
          void act(async () => {
            const created = await api.auth.createInvite({
              email: email.trim() || undefined,
              role,
            });
            setLink(created.url);
            setEmail('');
          });
        }}
      >
        <label className="field" style={{ flex: 1, maxWidth: 260 }}>
          <span className="field-label">Email (optional)</span>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Leave blank for a shareable link"
          />
        </label>
        <label className="field">
          <span className="field-label">Joins as</span>
          <select
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as 'member' | 'admin')}
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <button className="btn btn-primary" type="submit">
          Create invitation
        </button>
      </form>

      {link && (
        <div className="draft-chip" style={{ marginBottom: 18, width: '100%' }}>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{link}</span>
          <button className="btn btn-ghost" onClick={() => void navigator.clipboard.writeText(link)}>
            Copy
          </button>
        </div>
      )}

      <div className="admin-table">
        {invites.map((invite) => (
          <div className="admin-row" key={invite.id} data-inactive={invite.status !== 'pending'}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="admin-row-title">
                {invite.email ?? 'Shareable link'}
                <span className="role-pill" data-muted={invite.status !== 'pending'}>
                  {invite.status}
                </span>
                {invite.role !== 'member' && <span className="role-pill">{invite.role}</span>}
              </div>
              <div className="admin-row-meta">
                Created by {invite.createdByName ?? 'someone'} {formatRelative(invite.createdAt)}
                {invite.acceptedByName && ` · accepted by ${invite.acceptedByName}`}
              </div>
            </div>
            {invite.status === 'pending' && (
              <button
                className="btn"
                onClick={() => void act(() => api.admin.revokeInvite(invite.id))}
              >
                Revoke
              </button>
            )}
          </div>
        ))}
        {invites.length === 0 && <p className="muted">No invitations yet.</p>}
      </div>
    </section>
  );
}

function ChannelsSection({ onError }: { onError: (message: string | null) => void }) {
  const [channels, setChannels] = useState<AdminChannel[]>([]);

  const load = useCallback(() => {
    void api.admin
      .channels()
      .then((r) => setChannels(r.channels))
      .catch(() => onError('Could not load channels.'));
  }, [onError]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);
  const act = useAdminAction(onError, load);

  return (
    <section className="admin-table">
      {channels.map((channel) => (
        <div className="admin-row" key={channel.id} data-inactive={channel.archivedAt !== null}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="admin-row-title">
              {channel.name ? `#${channel.name}` : 'Direct message'}
              {channel.kind !== 'public' && <span className="role-pill">{channel.kind}</span>}
              {channel.archivedAt && (
                <span className="role-pill" data-muted>
                  archived
                </span>
              )}
            </div>
            <div className="admin-row-meta">
              {channel.memberCount} members · {channel.messageCount} messages
              {channel.lastMessageAt
                ? ` · active ${formatRelative(channel.lastMessageAt)}`
                : ' · never used'}
            </div>
          </div>
          {!channel.archivedAt && channel.kind !== 'dm' && channel.kind !== 'group_dm' && (
            <button
              className="btn"
              onClick={() => {
                if (confirm(`Archive #${channel.name}? It stays searchable but read-only.`)) {
                  void act(() => api.admin.archiveChannel(channel.id));
                }
              }}
            >
              Archive
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

function AppsSection({ onError }: { onError: (message: string | null) => void }) {
  const [catalog, setCatalog] = useState<AdminPluginCatalog | null>(null);
  const [plugins, setPlugins] = useState<AdminPlugin[]>([]);
  const [deliveries, setDeliveries] = useState<Record<string, AdminPluginDelivery[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [secretNotice, setSecretNotice] = useState<{
    pluginName: string;
    signingSecret?: string;
    botToken?: string;
  } | null>(null);
  const [form, setForm] = useState({
    slug: '',
    name: '',
    description: '',
    version: '1.0.0',
    requestUrl: '',
    events: [] as string[],
    scopes: [] as string[],
  });

  const load = useCallback(() => {
    setLoading(true);
    void Promise.all([api.admin.pluginCatalog(), api.admin.plugins()])
      .then(([nextCatalog, nextPlugins]) => {
        setCatalog(nextCatalog);
        setPlugins(nextPlugins.plugins);
      })
      .catch(() => onError('Could not load apps.'))
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);
  const act = useAdminAction(onError, load);

  const copySecret = async (value: string) => {
    await navigator.clipboard.writeText(value);
  };

  const loadDeliveries = async (pluginId: string) => {
    try {
      const response = await api.admin.pluginDeliveries(pluginId);
      setDeliveries((current) => ({ ...current, [pluginId]: response.deliveries }));
    } catch {
      onError('Could not load delivery attempts.');
    }
  };

  const toggleDeliveries = (pluginId: string) => {
    setSelectedPluginId((current) => (current === pluginId ? null : pluginId));
    if (!deliveries[pluginId]) {
      void loadDeliveries(pluginId);
    }
  };

  return (
    <section>
      <div className="admin-apps-shell">
        <div className="admin-apps-intro">
          <div>
            <h2 className="admin-apps-title">External apps and agent endpoints</h2>
            <p className="pref-hint" style={{ margin: '6px 0 0' }}>
              Register HTTPS endpoints, grant only the scopes they need, and keep every
              secret rotation and delivery attempt visible to admins.
            </p>
          </div>
          <div className="role-pill">zero-trust</div>
        </div>

        {secretNotice && (
          <div className="admin-secret-card">
            <div style={{ minWidth: 0 }}>
              <div className="admin-row-title">{secretNotice.pluginName}</div>
              <div className="admin-row-meta">
                These credentials are shown once. Rotate them later if you lose them.
              </div>
            </div>
            {secretNotice.signingSecret && (
              <div className="draft-chip admin-secret-chip">
                <span className="admin-secret-label">Signing secret</span>
                <code>{secretNotice.signingSecret}</code>
                <button className="btn btn-ghost" onClick={() => void copySecret(secretNotice.signingSecret!)}>
                  Copy
                </button>
              </div>
            )}
            {secretNotice.botToken && (
              <div className="draft-chip admin-secret-chip">
                <span className="admin-secret-label">Bot token</span>
                <code>{secretNotice.botToken}</code>
                <button className="btn btn-ghost" onClick={() => void copySecret(secretNotice.botToken!)}>
                  Copy
                </button>
              </div>
            )}
          </div>
        )}

        <DeployAgentForm
          scopeCatalog={catalog?.scopes ?? {}}
          onError={onError}
          onInstalled={(pluginName, signingSecret, botToken) => {
            setSecretNotice({ pluginName, signingSecret, botToken });
            load();
          }}
        />

        <form
          className="admin-app-form"
          onSubmit={(event) => {
            event.preventDefault();
            onError(null);
            void api.admin
              .installPlugin({
                slug: form.slug.trim(),
                name: form.name.trim(),
                description: form.description.trim() || null,
                runtime: 'external',
                version: form.version.trim() || '1.0.0',
                requestUrl: form.requestUrl.trim(),
                events: form.events,
                scopes: form.scopes,
              })
              .then((installed) => {
                setSecretNotice({
                  pluginName: installed.plugin.name,
                  signingSecret: installed.signingSecret,
                  botToken: installed.botToken,
                });
                setForm({
                  slug: '',
                  name: '',
                  description: '',
                  version: '1.0.0',
                  requestUrl: '',
                  events: [],
                  scopes: [],
                });
                load();
              })
              .catch((err) => {
                onError(err instanceof ApiError ? err.message : 'Could not install the app.');
              });
          }}
        >
          <label className="field">
            <span className="field-label">Slug</span>
            <input
              className="input"
              value={form.slug}
              onChange={(e) => setForm((current) => ({ ...current, slug: e.target.value }))}
              placeholder="standup-bot"
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Name</span>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
              placeholder="Standup Bot"
              required
            />
          </label>
          <label className="field admin-app-form-wide">
            <span className="field-label">Description</span>
            <input
              className="input"
              value={form.description}
              onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
              placeholder="Collects standup notes every morning"
            />
          </label>
          <label className="field">
            <span className="field-label">Version</span>
            <input
              className="input"
              value={form.version}
              onChange={(e) => setForm((current) => ({ ...current, version: e.target.value }))}
              placeholder="1.0.0"
              required
            />
          </label>
          <label className="field admin-app-form-wide">
            <span className="field-label">Request URL</span>
            <input
              className="input"
              type="url"
              value={form.requestUrl}
              onChange={(e) => setForm((current) => ({ ...current, requestUrl: e.target.value }))}
              placeholder="https://apps.example.com/blob/events"
              required
            />
          </label>

          <div className="admin-app-permissions">
            <div>
              <div className="section-label" style={{ paddingLeft: 0 }}>
                Event subscriptions
              </div>
              <div className="admin-check-grid">
                {catalog &&
                  Object.entries(catalog.events).map(([eventKey, description]) => (
                    <label className="admin-check-card" key={eventKey}>
                      <input
                        type="checkbox"
                        aria-label={eventKey}
                        checked={form.events.includes(eventKey)}
                        onChange={() =>
                          setForm((current) => ({
                            ...current,
                            events: toggleChoice(current.events, eventKey),
                          }))
                        }
                      />
                      <span>
                        <strong>{eventKey}</strong>
                        <small>{description}</small>
                      </span>
                    </label>
                  ))}
              </div>
            </div>
            <div>
              <div className="section-label" style={{ paddingLeft: 0 }}>
                Granted scopes
              </div>
              <div className="admin-check-grid">
                {catalog &&
                  Object.entries(catalog.scopes).map(([scopeKey, description]) => (
                    <label className="admin-check-card" key={scopeKey}>
                      <input
                        type="checkbox"
                        aria-label={scopeKey}
                        checked={form.scopes.includes(scopeKey)}
                        onChange={() =>
                          setForm((current) => ({
                            ...current,
                            scopes: toggleChoice(current.scopes, scopeKey),
                          }))
                        }
                      />
                      <span>
                        <strong>{scopeKey}</strong>
                        <small>{description}</small>
                      </span>
                    </label>
                  ))}
              </div>
            </div>
          </div>

          <div className="admin-app-form-actions">
            <div className="pref-hint">Blob only installs external apps here. Local plugins remain deploy-time code.</div>
            <button className="btn btn-primary" type="submit">
              Install app
            </button>
          </div>
        </form>

        {loading && plugins.length === 0 ? (
          <p className="muted">Loading apps…</p>
        ) : (
          <div className="admin-table">
            {plugins.map((plugin) => {
              const expanded = selectedPluginId === plugin.id;
              const pluginDeliveries = deliveries[plugin.id] ?? [];
              const enabled = plugin.status === 'enabled';
              return (
                <div className="admin-plugin-card" key={plugin.id}>
                  <div className="admin-row">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="admin-row-title">
                        {plugin.name}
                        <span className="role-pill">{plugin.status.replace('_', ' ')}</span>
                        <span className="role-pill" data-muted>
                          v{plugin.version}
                        </span>
                      </div>
                      <div className="admin-row-meta">
                        {plugin.description || plugin.slug}
                        {plugin.requestUrl && ` · ${plugin.requestUrl}`}
                        {plugin.botUserId && ` · bot user ${plugin.botUserId}`}
                      </div>
                      <div className="chip-row" style={{ marginTop: 10 }}>
                        {plugin.events.map((eventName) => (
                          <span className="chip" key={eventName}>
                            {eventName}
                          </span>
                        ))}
                        {plugin.scopes.map((scope) => (
                          <span className="chip" key={scope}>
                            {scope}
                          </span>
                        ))}
                        {plugin.pendingDeliveries > 0 && (
                          <span className="role-pill" data-muted>
                            {plugin.pendingDeliveries} pending
                          </span>
                        )}
                        {plugin.failedDeliveries > 0 && (
                          <span className="role-pill">{plugin.failedDeliveries} failed</span>
                        )}
                      </div>
                      {plugin.runtime === 'container' && (
                        <AgentDeployment
                          pluginId={plugin.id}
                          repo={plugin.sourceRepo ?? null}
                          ref={plugin.sourceRef ?? null}
                          onError={onError}
                        />
                      )}

                      {plugin.lastError && (
                        <p className="error-text" style={{ margin: '10px 0 0' }}>
                          {plugin.lastError}
                        </p>
                      )}
                    </div>

                    <div className="admin-row-actions admin-plugin-actions">
                      {plugin.status === 'needs_review' && (
                        <button
                          className="btn btn-primary"
                          onClick={() => void act(() => api.admin.approvePlugin(plugin.id))}
                        >
                          Approve
                        </button>
                      )}
                      <button
                        className="btn"
                        onClick={() =>
                          void act(() => api.admin.setPluginEnabled(plugin.id, !enabled))
                        }
                      >
                        {enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button className="btn btn-ghost" onClick={() => toggleDeliveries(plugin.id)}>
                        {expanded ? 'Hide deliveries' : 'Show deliveries'}
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => {
                          onError(null);
                          void api.admin
                            .rotatePluginSecret(plugin.id)
                            .then((result) =>
                              setSecretNotice({
                                pluginName: plugin.name,
                                signingSecret: result.signingSecret,
                              }),
                            )
                            .catch((err) =>
                              onError(err instanceof ApiError ? err.message : 'Could not rotate the signing secret.'),
                            );
                        }}
                      >
                        Rotate secret
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => {
                          onError(null);
                          void api.admin
                            .issuePluginToken(plugin.id)
                            .then((result) =>
                              setSecretNotice({
                                pluginName: plugin.name,
                                botToken: result.botToken,
                              }),
                            )
                            .catch((err) =>
                              onError(err instanceof ApiError ? err.message : 'Could not issue a bot token.'),
                            );
                        }}
                      >
                        Issue token
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => void act(() => api.admin.revokePluginTokens(plugin.id))}
                      >
                        Revoke tokens
                      </button>
                      <button
                        className="btn"
                        onClick={() => {
                          if (confirm(`Uninstall ${plugin.name}?`)) {
                            void act(() => api.admin.uninstallPlugin(plugin.id));
                          }
                        }}
                      >
                        Uninstall
                      </button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="admin-plugin-deliveries">
                      {pluginDeliveries.length > 0 ? (
                        pluginDeliveries.map((delivery) => (
                          <div className="admin-row" key={delivery.id}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="admin-row-title">
                                {delivery.event}
                                <span className="role-pill" data-muted={delivery.status !== 'delivered'}>
                                  {delivery.status}
                                </span>
                              </div>
                              <div className="admin-row-meta">
                                {delivery.attempts} attempts · created {formatRelative(delivery.createdAt)}
                                {delivery.deliveredAt &&
                                  ` · delivered ${formatRelative(delivery.deliveredAt)}`}
                                {delivery.lastStatusCode && ` · HTTP ${delivery.lastStatusCode}`}
                                {delivery.lastError && ` · ${delivery.lastError}`}
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="muted">No delivery attempts recorded yet.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {plugins.length === 0 && (
              <div className="empty-state" style={{ margin: '32px auto 0' }}>
                <div className="empty-state-title">No apps installed yet</div>
                <div className="empty-state-body">
                  Register an external app to connect project tools, bots, or internal
                  agent services into this workspace.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function AuditSection() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [filter, setFilter] = useState<string>('');

  useEffect(() => {
    void api.admin
      .audit({ action: filter || undefined })
      .then((r) => setEvents(r.events))
      .catch(() => setEvents([]));
  }, [filter]);

  const actions = [...new Set(events.map((e) => e.action))].sort();

  return (
    <section>
      <div className="chip-row" style={{ marginBottom: 18 }}>
        <button className="chip" aria-pressed={filter === ''} onClick={() => setFilter('')}>
          Everything
        </button>
        {actions.map((action) => (
          <button
            key={action}
            className="chip"
            aria-pressed={filter === action}
            onClick={() => setFilter(action)}
          >
            {humanizeAction(action)}
          </button>
        ))}
      </div>

      <div className="admin-table">
        {events.map((event) => (
          <div className="admin-row" key={event.id}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="admin-row-title">
                {humanizeAction(event.action)}
                {event.targetLabel && <span className="role-pill">{event.targetLabel}</span>}
              </div>
              <div className="admin-row-meta">
                {event.actorName ?? 'Someone'} · {formatRelative(event.createdAt)}
                {event.ip && ` · ${event.ip}`}
                {Object.keys(event.metadata).length > 0 &&
                  ` · ${Object.entries(event.metadata)
                    .map(([k, v]) => `${k}: ${String(v)}`)
                    .join(', ')}`}
              </div>
            </div>
          </div>
        ))}
        {events.length === 0 && <p className="muted">Nothing recorded yet.</p>}
      </div>
    </section>
  );
}

function SettingsSection({ onError }: { onError: (message: string | null) => void }) {
  const [name, setName] = useState('');
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [webhooks, setWebhooks] = useState<AdminWebhook[]>([]);
  const [saved, setSaved] = useState(false);
  const channels = useStore((s) => s.channels);

  const load = useCallback(() => {
    void api.admin.settings().then((r) => setName(r.name)).catch(() => onError('Could not load settings.'));
    void api.admin.health().then(setHealth).catch(() => setHealth(null));
    void api.admin.webhooks().then((r) => setWebhooks(r.webhooks)).catch(() => setWebhooks([]));
  }, [onError]);

  useEffect(load, [load]);
  const act = useAdminAction(onError, load);

  return (
    <section>
      <form
        style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}
        onSubmit={(event) => {
          event.preventDefault();
          void act(async () => {
            const updated = await api.admin.updateSettings({ name: name.trim() });
            useStore.setState({ workspaceName: updated.name });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          });
        }}
      >
        <label className="field" style={{ maxWidth: 280, flex: 1 }}>
          <span className="field-label">Workspace name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn btn-primary" type="submit">
          {saved ? 'Saved' : 'Save'}
        </button>
      </form>

      <h2 className="section-label" style={{ marginTop: 30, paddingLeft: 0 }}>
        Health
      </h2>
      {health ? (
        <div className="health-grid">
          <Stat label="Database" value={health.database ? 'Reachable' : 'Down'} bad={!health.database} />
          <Stat label="Redis" value={health.redis ? 'Reachable' : 'Down'} bad={!health.redis} />
          <Stat label="Queue depth" value={String(health.queueDepth)} />
          <Stat label="Live sockets" value={String(health.connections)} />
          <Stat label="People online" value={String(health.usersOnline)} />
          <Stat label="Messages" value={health.messageCount.toLocaleString()} />
          <Stat label="Stored files" value={formatBytes(health.storageBytes)} />
          <Stat label="Version" value={health.version} />
        </div>
      ) : (
        <p className="muted">Health unavailable.</p>
      )}

      <h2 className="section-label" style={{ marginTop: 30, paddingLeft: 0 }}>
        Incoming webhooks
      </h2>
      <p className="pref-hint" style={{ marginBottom: 12 }}>
        Post into a channel from CI or a cron job. The URL is shown once — store it somewhere
        safe.
      </p>

      <form
        style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.target as HTMLFormElement;
          const channelId = (form.elements.namedItem('channel') as HTMLSelectElement).value;
          const label = (form.elements.namedItem('label') as HTMLInputElement).value.trim();
          if (!channelId || !label) return;
          void act(async () => {
            const created = await api.admin.createWebhook(channelId, label);
            if (created.url) alert(`Webhook URL (shown once):\n\n${created.url}`);
            form.reset();
          });
        }}
      >
        <label className="field">
          <span className="field-label">Channel</span>
          <select className="input" name="channel" defaultValue="">
            <option value="" disabled>
              Pick one
            </option>
            {Object.values(channels)
              .filter((c) => c.name && !c.archivedAt)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Name</span>
          <input className="input" name="label" placeholder="CI" />
        </label>
        <button className="btn" type="submit">
          Create
        </button>
      </form>

      <div className="admin-table">
        {webhooks.map((hook) => (
          <div className="admin-row" key={hook.id}>
            <div style={{ flex: 1 }}>
              <div className="admin-row-title">{hook.name}</div>
              <div className="admin-row-meta">
                {hook.lastUsedAt ? `Last used ${formatRelative(hook.lastUsedAt)}` : 'Never used'}
              </div>
            </div>
            <button
              className="btn"
              onClick={() => {
                if (confirm(`Revoke "${hook.name}"? Anything using it stops working.`)) {
                  void act(() => api.admin.revokeWebhook(hook.id));
                }
              }}
            >
              Revoke
            </button>
          </div>
        ))}
        {webhooks.length === 0 && <p className="muted">No webhooks yet.</p>}
      </div>
    </section>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value" data-bad={bad}>
        {value}
      </div>
    </div>
  );
}

function toggleChoice(items: string[], value: string): string[] {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
}
