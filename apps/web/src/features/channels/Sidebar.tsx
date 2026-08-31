/** Channel and DM navigation. */

import { useMemo, useState } from 'react';
import type { ChannelWithState } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { showError } from '../../lib/toasts.ts';
import { navigate, parseRoute, usePath } from '../../lib/router.ts';
import { useStore } from '../../lib/store.ts';
import { showChannel } from '../../lib/navigation.ts';
import { channelHasDraft } from '../../lib/drafts.ts';
import { AvatarWithPresence } from '../../components/Avatar.tsx';
import {
  FileIcon,
  PinIcon,
  PlusIcon,
  ReplyIcon,
} from '../../components/Icon.tsx';
import { CreateChannelDialog } from './CreateChannelDialog.tsx';

export function Sidebar() {
  const channels = useStore((s) => s.channels);
  const users = useStore((s) => s.users);
  const presence = useStore((s) => s.presence);
  const currentUser = useStore((s) => s.currentUser);
  const workspaceName = useStore((s) => s.workspaceName);
  const activeView = parseRoute(usePath()).view;
  const savedCount = useStore((s) => s.savedMessageIds.size);

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
    try {
      const { channel } = await api.dms.open([userId]);
      useStore.setState((s) => ({ channels: { ...s.channels, [channel.id]: channel } }));
      await showChannel(channel.id);
    } catch (err) {
      showError(err);
    }
  }

  return (
    <div className="sidebar">
      <WorkspaceHeading name={workspaceName} memberCount={memberCount} />

      <div className="sidebar-scroll">
        {/* Above the channel list, where Slack keeps it. `GET /api/threads` has been
            answering this question since the port; nothing asked it. */}
        <section className="sidebar-section">
          <button
            className="channel-row"
            aria-current={activeView === 'threads'}
            onClick={() => navigate('/threads')}
          >
            <span className="channel-hash" aria-hidden="true">
              <ReplyIcon size={13} strokeWidth={1.8} />
            </span>
            <span className="channel-name">Threads</span>
          </button>
          <button
            className="channel-row"
            aria-current={activeView === 'tasks'}
            onClick={() => navigate('/tasks')}
          >
            <span className="channel-hash" aria-hidden="true">
              <FileIcon size={13} strokeWidth={1.8} />
            </span>
            <span className="channel-name">Tasks</span>
          </button>
          <button
            className="channel-row"
            aria-current={activeView === 'saved'}
            onClick={() => navigate('/later')}
          >
            <span className="channel-hash" aria-hidden="true">
              <PinIcon size={13} strokeWidth={1.8} />
            </span>
            <span className="channel-name">Later</span>
            {savedCount > 0 && <span className="badge badge-quiet">{savedCount}</span>}
          </button>
        </section>

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
                    try {
                      const { channel: joinedChannel } = await api.channels.join(channel.id);
                      useStore.setState((s) => ({
                        channels: { ...s.channels, [joinedChannel.id]: joinedChannel },
                      }));
                      await showChannel(joinedChannel.id);
                    } catch (err) {
                      showError(err);
                    }
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

/**
 * The workspace name, and how many people are in it.
 *
 * It used to be a button opening a two-row menu — Administration and Preferences. Both
 * already had two other doors each (the bar's own buttons, and the account menu), and
 * the sidebar's copy of Administration pointed at the *instance* console while showing
 * itself to any admin, where the account menu gates that same destination to owners
 * because every one of its endpoints is owner-gated. So the menu offered nothing that
 * was not offered twice elsewhere, and offered one thing wrongly.
 *
 * The member count stays: this is the only place in the conversation view that says how
 * large the workspace is.
 */
function WorkspaceHeading({ name, memberCount }: { name: string; memberCount: number }) {
  return (
    <div className="sidebar-header">
      <div className="workspace-name">{name}</div>
      <div className="workspace-meta">
        {memberCount} {memberCount === 1 ? 'member' : 'members'}
      </div>
    </div>
  );
}

/**
 * One row in the channel list. At module scope on purpose: defined inside `Sidebar`
 * it was a brand-new component *type* on every render, so React unmounted and
 * remounted every row on every presence tick and every draft keystroke. It reads its
 * own store slices, so a presence flip re-renders rows rather than rebuilding them.
 */
function ChannelRow({ channel }: { channel: ChannelWithState }) {
  const activeChannelId = useStore((s) => s.activeChannelId);
  const currentUserId = useStore((s) => s.currentUser?.id ?? null);
  const users = useStore((s) => s.users);
  const presence = useStore((s) => s.presence);
  const drafts = useStore((s) => s.drafts);
  const channelTitle = useStore((s) => s.channelTitle);

  const active = channel.id === activeChannelId;
  const isDm = channel.kind === 'dm' || channel.kind === 'group_dm';
  const otherId =
    channel.kind === 'dm'
      ? (channel.memberIds ?? []).find((id) => id !== currentUserId)
      : undefined;

  return (
    <button
      className="channel-row"
      aria-current={active}
      data-unread={channel.hasUnread && !active}
      onClick={() => void showChannel(channel.id)}
    >
      {otherId ? (
        <AvatarWithPresence user={users[otherId]} state={presence[otherId] ?? 'offline'} />
      ) : (
        <span className="channel-hash" aria-hidden="true">
          {isDm ? '•' : '#'}
        </span>
      )}
      <span className="channel-name">{channel.name ?? channelTitle(channel)}</span>
      {/* A draft you cannot see is a draft you forget you left. Suppressed on the
          channel you are looking at, where the text is already on screen. */}
      {!active && channelHasDraft(drafts, channel.id) && (
        <span className="channel-draft" title="You have an unsent draft here">
          draft
        </span>
      )}
      {channel.mentionCount > 0 && <span className="badge">{channel.mentionCount}</span>}
    </button>
  );
}
