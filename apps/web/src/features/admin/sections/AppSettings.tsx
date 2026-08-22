/** One app's settings.
 *
 * The list answers "what is installed"; this answers "why is it not doing anything",
 * which until now had no screen at all. The load-bearing part is the channel list: an
 * installed app is inert until its bot is a member somewhere, and an app that answers
 * over AG-UI never calls Blob on its own, so it cannot join for itself the way a webhook
 * app can. Before this, installing an agent produced something that looked installed and
 * spoke nowhere, with nothing on screen to say why.
 */

import { useCallback, useState } from 'react';
import { api, type AdminPlugin, type AppChannel } from '../../../lib/api.ts';
import { navigate } from '../../../lib/router.ts';
import { useAdminAction, useAdminData } from '../hooks.ts';

interface Props {
  pluginId: string;
  onError: (message: string | null) => void;
}

export function AppSettings({ pluginId, onError }: Props) {
  const [plugin, setPlugin] = useState<AdminPlugin | null>(null);
  const [channels, setChannels] = useState<AppChannel[]>([]);

  const load = useCallback(async () => {
    const [all, listed] = await Promise.all([
      api.admin.plugins(),
      api.admin.appChannels(pluginId),
    ]);
    setPlugin(all.plugins.find((row) => row.id === pluginId) ?? null);
    setChannels(listed.channels);
    return listed;
  }, [pluginId]);

  const { loading, reload } = useAdminData(load, [pluginId], onError, 'Could not load that app.');
  const act = useAdminAction(onError, reload);

  if (loading && !plugin) return <p className="pref-hint">Loading…</p>;
  if (!plugin) return <p className="pref-hint">That app is not installed here.</p>;

  const endpoint = plugin.aguiUrl ?? plugin.requestUrl;
  const joined = channels.filter((channel) => channel.joined);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      <div>
        <button className="btn btn-ghost" onClick={() => navigate('/admin/apps')}>
          ← All apps
        </button>
      </div>

      <div>
        <h2 style={{ margin: '0 0 4px', fontSize: 'var(--text-lg)', fontWeight: 600 }}>
          {plugin.name}
        </h2>
        <div className="pref-hint">
          {plugin.slug} · v{plugin.version} · {plugin.status}
          {plugin.aguiUrl ? ' · answers over AG-UI' : ''}
        </div>
      </div>

      {plugin.lastError && (
        <div className="connection-banner">
          Last failure: {plugin.lastError}
        </div>
      )}

      <div>
        <h3 className="section-label" style={{ paddingLeft: 0 }}>
          Endpoint
        </h3>
        <div className="pref-hint" style={{ wordBreak: 'break-all' }}>
          {endpoint ?? 'None — this app is not reachable over the network.'}
        </div>
      </div>

      <div>
        <h3 className="section-label" style={{ paddingLeft: 0 }}>
          Channels
        </h3>
        <div className="pref-hint" style={{ marginBottom: 10 }}>
          {joined.length === 0
            ? 'This app is not in any channel yet, so nobody can reach it. Add it to one.'
            : `Mentioning it in ${
                joined.length === 1 ? 'this channel' : 'these channels'
              } will reach it.`}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {channels.length === 0 && (
            <div className="pref-hint">There are no public channels to add it to.</div>
          )}
          {channels.map((channel) => (
            <div className="pref-row" key={channel.id}>
              <div>
                <div className="pref-label">#{channel.name ?? channel.id}</div>
              </div>
              <button
                className={channel.joined ? 'btn btn-ghost' : 'btn'}
                onClick={() =>
                  void act(() =>
                    channel.joined
                      ? api.admin.appLeaveChannel(pluginId, channel.id)
                      : api.admin.appJoinChannel(pluginId, channel.id),
                  )
                }
              >
                {channel.joined ? 'Remove' : 'Add'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="section-label" style={{ paddingLeft: 0 }}>
          Permissions
        </h3>
        <div className="pref-hint">
          {plugin.scopes.length ? plugin.scopes.join(', ') : 'None granted.'}
        </div>
      </div>
    </section>
  );
}
