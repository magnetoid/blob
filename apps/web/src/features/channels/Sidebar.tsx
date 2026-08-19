/** Channel and DM navigation. */

import { useMemo, useState } from 'react';
import type { ChannelWithState } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { AvatarWithPresence } from '../../components/Avatar.tsx';
import { PlusIcon, SearchIcon } from '../../components/Icon.tsx';
import { CreateChannelDialog } from './CreateChannelDialog.tsx';

interface Props {
  onOpenSearch: () => void;
}

export function Sidebar({ onOpenSearch }: Props) {
  const channels = useStore((s) => s.channels);
  const users = useStore((s) => s.users);
  const presence = useStore((s) => s.presence);
  const currentUser = useStore((s) => s.currentUser);
  const workspaceName = useStore((s) => s.workspaceName);
  const activeChannelId = useStore((s) => s.activeChannelId);
  const openChannel = useStore((s) => s.openChannel);
  const channelTitle = useStore((s) => s.channelTitle);

  const [creating, setCreating] = useState(false);

  const { joined, dms, browsable } = useMemo(() => {
    const all = Object.values(channels);
    const mine = all.filter((c) => c.membership !== null && !c.archivedAt);
    const sortByName = (a: ChannelWithState, b: ChannelWithState) =>
      (a.name ?? '').localeCompare(b.name ?? '');
    return {
      joined: mine
        .filter((c) => c.kind === 'public' || c.kind === 'private')
        .sort((a, b) => {
          const starred = Number(b.membership?.isStarred) - Number(a.membership?.isStarred);
          return starred !== 0 ? starred : sortByName(a, b);
        }),
      dms: mine.filter((c) => c.kind === 'dm' || c.kind === 'group_dm'),
      browsable: all.filter((c) => c.membership === null && !c.archivedAt).sort(sortByName),
    };
  }, [channels]);

  const people = useMemo(
    () =>
      Object.values(users)
        .filter((u) => u.id !== currentUser?.id && !u.deactivated)
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [users, currentUser],
  );

  const memberCount = Object.values(users).filter((u) => !u.deactivated).length;

  async function openDm(userId: string) {
    const { channel } = await api.dms.open([userId]);
    useStore.setState((s) => ({ channels: { ...s.channels, [channel.id]: channel } }));
    await openChannel(channel.id);
  }

  function ChannelRow({ channel }: { channel: ChannelWithState }) {
    const active = channel.id === activeChannelId;
    const isDm = channel.kind === 'dm' || channel.kind === 'group_dm';
    const otherId =
      channel.kind === 'dm'
        ? (channel.memberIds ?? []).find((id) => id !== currentUser?.id)
        : undefined;

    return (
      <button
        className="channel-row"
        aria-current={active}
        data-unread={channel.hasUnread && !active}
        onClick={() => void openChannel(channel.id)}
      >
        {otherId ? (
          <AvatarWithPresence user={users[otherId]} state={presence[otherId] ?? 'offline'} />
        ) : (
          <span className="channel-hash" aria-hidden="true">
            {isDm ? '•' : '#'}
          </span>
        )}
        <span className="channel-name">{channel.name ?? channelTitle(channel)}</span>
        {channel.mentionCount > 0 && <span className="badge">{channel.mentionCount}</span>}
      </button>
    );
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="workspace-name">{workspaceName}</div>
        <div className="workspace-meta">
          {memberCount} {memberCount === 1 ? 'member' : 'members'}
        </div>
      </div>

      <div className="sidebar-search">
        <button className="search-trigger" onClick={onOpenSearch}>
          <SearchIcon size={14} strokeWidth={2} />
          Search {workspaceName}
        </button>
      </div>

      <div className="sidebar-scroll">
        <section className="sidebar-section">
          <h2 className="section-label">Channels</h2>
          {joined.map((channel) => (
            <ChannelRow key={channel.id} channel={channel} />
          ))}

          {browsable.length > 0 && (
            <details>
              <summary className="channel-row" style={{ listStyle: 'none' }}>
                <span className="channel-name muted">
                  {browsable.length} more you can join
                </span>
              </summary>
              {browsable.map((channel) => (
                <button
                  key={channel.id}
                  className="channel-row"
                  onClick={async () => {
                    const { channel: joinedChannel } = await api.channels.join(channel.id);
                    useStore.setState((s) => ({
                      channels: { ...s.channels, [joinedChannel.id]: joinedChannel },
                    }));
                    await openChannel(joinedChannel.id);
                  }}
                >
                  <span className="channel-hash" aria-hidden="true">
                    #
                  </span>
                  <span className="channel-name">{channel.name}</span>
                </button>
              ))}
            </details>
          )}

          <button className="sidebar-add" onClick={() => setCreating(true)}>
            <PlusIcon size={14} />
            New channel
          </button>
        </section>

        <section className="sidebar-section">
          <h2 className="section-label">Direct messages</h2>
          {dms.map((channel) => (
            <ChannelRow key={channel.id} channel={channel} />
          ))}
          {people
            .filter(
              (person) =>
                !dms.some((dm) => dm.kind === 'dm' && (dm.memberIds ?? []).includes(person.id)),
            )
            .map((person) => (
              <button key={person.id} className="channel-row" onClick={() => void openDm(person.id)}>
                <AvatarWithPresence user={person} state={presence[person.id] ?? 'offline'} />
                <span className="channel-name">{person.displayName}</span>
              </button>
            ))}
        </section>
      </div>

      {creating && <CreateChannelDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
