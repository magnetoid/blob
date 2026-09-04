/** Channel and DM navigation. */

import { useMemo, useState } from 'react';
import type { ChannelWithState } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { showError } from '../../lib/toasts.ts';
import { navigate, parseRoute, usePath } from '../../lib/router.ts';
import { useStore } from '../../lib/store.ts';
import { showChannel } from '../../lib/navigation.ts';
import { channelHasDraft } from '../../lib/drafts.ts';
import { directMessages, joinedChannels } from '../../lib/conversations.ts';
import { AvatarWithPresence } from '../../components/Avatar.tsx';
import {
  ClockIcon,
  FileIcon,
  PinIcon,
  PlusIcon,
  ReplyIcon,
  SearchIcon,
} from '../../components/Icon.tsx';
import { CreateChannelDialog } from './CreateChannelDialog.tsx';
import { NewMessageDialog } from './NewMessageDialog.tsx';

export function Sidebar() {
  const channels = useStore((s) => s.channels);
  const users = useStore((s) => s.users);
  const presence = useStore((s) => s.presence);
  const currentUser = useStore((s) => s.currentUser);
  const workspaceName = useStore((s) => s.workspaceName);
  const activeView = parseRoute(usePath()).view;
  const savedCount = useStore((s) => s.savedMessageIds.size);

  const [creating, setCreating] = useState(false);
  const [composing, setComposing] = useState(false);

  // The two sections come from `lib/conversations`, which is also what ⌥↑ and ⌥↓ walk.
  // They were the same sort written twice and had already drifted — the keyboard copy
  // put DMs in among the channels, by a name a DM does not have, so stepping through
  // "the list" moved through one nobody could see.
  const { joined, dms, browsable } = useMemo(
    () => ({
      joined: joinedChannels(channels),
      dms: directMessages(channels),
      browsable: Object.values(channels)
        .filter((c) => c.membership === null && !c.archivedAt)
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    }),
    [channels],
  );

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
              <ReplyIcon size="sm" />
            </span>
            <span className="channel-name">Threads</span>
          </button>
          <button
            className="channel-row"
            aria-current={activeView === 'tasks'}
            onClick={() => navigate('/tasks')}
          >
            <span className="channel-hash" aria-hidden="true">
              <FileIcon size="sm" />
            </span>
            <span className="channel-name">Tasks</span>
          </button>
          <button
            className="channel-row"
            aria-current={activeView === 'saved'}
            onClick={() => navigate('/later')}
          >
            <span className="channel-hash" aria-hidden="true">
              <PinIcon size="sm" />
            </span>
            <span className="channel-name">Later</span>
            {savedCount > 0 && <span className="badge badge-quiet">{savedCount}</span>}
          </button>
          <button
            className="channel-row"
            aria-current={activeView === 'scheduled'}
            onClick={() => navigate('/scheduled')}
          >
            <span className="channel-hash" aria-hidden="true">
              <ClockIcon size="sm" />
            </span>
            <span className="channel-name">Scheduled</span>
          </button>
        </section>

        <section className="sidebar-section">
          <h2 className="section-label">Channels</h2>
          {joined.map((channel) => (
            <ChannelRow key={channel.id} channel={channel} />
          ))}

          {/* A link to the directory rather than the directory itself. This was a
              <details> of bare names, which answers "what is it called" and nothing
              else — no description, no member count, no search. Fine for four
              channels, useless for fifty. */}
          <button
            className="channel-row"
            aria-current={activeView === 'browse'}
            onClick={() => navigate('/channels')}
          >
            <span className="channel-hash" aria-hidden="true">
              <SearchIcon size="sm" />
            </span>
            <span className="channel-name muted">
              {browsable.length > 0 ? `Browse ${browsable.length} more` : 'Browse channels'}
            </span>
          </button>

          <button className="sidebar-add" onClick={() => setCreating(true)}>
            <PlusIcon size="sm" />
            New channel
          </button>
        </section>

        <section className="sidebar-section">
          <div className="section-label-row">
            <h2 className="section-label">Direct messages</h2>
            {/* The counterpart to "New channel", which had none: starting a conversation
                meant knowing ⌘⇧K or scrolling for a name, and a group message could only
                be made by typing a slash command. */}
            <button
              className="sidebar-inline-add"
              onClick={() => setComposing(true)}
              aria-label="New message"
              data-tooltip="New message"
            >
              <PlusIcon size="sm" />
            </button>
          </div>
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
      {composing && <NewMessageDialog onClose={() => setComposing(false)} />}
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
