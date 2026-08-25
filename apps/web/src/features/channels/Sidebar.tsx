/** Channel and DM navigation. */

import { useEffect, useMemo, useState } from 'react';
import type { ChannelWithState } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { navigate, parseRoute, usePath } from '../../lib/router.ts';
import { useStore } from '../../lib/store.ts';
import { showChannel } from '../../lib/navigation.ts';
import { channelHasDraft } from '../../lib/drafts.ts';
import { AvatarWithPresence } from '../../components/Avatar.tsx';
import { ChevronDownIcon, PlusIcon, ReplyIcon, SearchIcon } from '../../components/Icon.tsx';
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
  const channelTitle = useStore((s) => s.channelTitle);
  const drafts = useStore((s) => s.drafts);
  const activeView = parseRoute(usePath()).view;

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
    await showChannel(channel.id);
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

  return (
    <div className="sidebar">
      <WorkspaceMenu name={workspaceName} memberCount={memberCount} />

      <div className="sidebar-search">
        <button className="search-trigger" onClick={onOpenSearch}>
          <SearchIcon size={14} strokeWidth={2} />
          Search {workspaceName}
        </button>
      </div>

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
                    const { channel: joinedChannel } = await api.channels.join(channel.id);
                    useStore.setState((s) => ({
                      channels: { ...s.channels, [joinedChannel.id]: joinedChannel },
                    }));
                    await showChannel(joinedChannel.id);
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
 * The workspace name, and the menu behind it.
 *
 * Slack puts administration here rather than in the rail, and someone looking for it
 * looks here first. The rail button stays: this adds a labelled way in, it does not
 * replace the one that exists.
 */
function WorkspaceMenu({ name, memberCount }: { name: string; memberCount: number }) {
  const currentUser = useStore((s) => s.currentUser);
  const [open, setOpen] = useState(false);
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'owner';

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      setOpen(false);
    };
    // Capture, so a click landing on any control still dismisses the menu first.
    window.addEventListener('click', close, true);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('click', close, true);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <div className="sidebar-header">
      <button
        className="workspace-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <span className="workspace-name">{name}</span>
        <ChevronDownIcon size={14} strokeWidth={2} />
      </button>
      <div className="workspace-meta">
        {memberCount} {memberCount === 1 ? 'member' : 'members'}
      </div>

      {open && (
        <div className="workspace-menu" role="menu">
          {isAdmin && (
            <button className="workspace-menu-item" role="menuitem" onClick={() => go('/admin')}>
              Administration
            </button>
          )}
          <button className="workspace-menu-item" role="menuitem" onClick={() => go('/workspace/preferences')}>
            Preferences
          </button>
        </div>
      )}
    </div>
  );
}
