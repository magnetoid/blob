/** Channel and DM navigation. */

import { useMemo, useState, type ReactNode } from 'react';
import type { ChannelWithState } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { showError } from '../../lib/toasts.ts';
import { navigate, parseRoute, usePath } from '../../lib/router.ts';
import { useStore } from '../../lib/store.ts';
import { showChannel } from '../../lib/navigation.ts';
import { channelHasDraft } from '../../lib/drafts.ts';
import { agentConversations, directMessages, joinedChannels } from '../../lib/conversations.ts';
import { WorkspaceSwitcher } from '../shell/WorkspaceSwitcher.tsx';
import { AvatarWithPresence } from '../../components/Avatar.tsx';
import {
  ChevronLeftIcon,
  ClockIcon,
  FileIcon,
  HomeIcon,
  MentionIcon,
  PinIcon,
  PlusIcon,
  ReplyIcon,
  SearchIcon,
} from '../../components/Icon.tsx';
import { CreateChannelDialog } from './CreateChannelDialog.tsx';
import { NewMessageDialog } from './NewMessageDialog.tsx';
import { ChannelMenu } from './ChannelMenu.tsx';

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({
  collapsed = false,
  onToggleCollapse,
}: SidebarProps = {}) {
  const channels = useStore((s) => s.channels);
  const users = useStore((s) => s.users);
  const presence = useStore((s) => s.presence);
  const currentUser = useStore((s) => s.currentUser);
  const activeView = parseRoute(usePath()).view;
  const savedCount = useStore((s) => s.savedMessageIds.size);
  const workspaceName = useStore((s) => s.workspaceName);
  const agentRuns = useStore((s) => s.agentRuns);

  const [creating, setCreating] = useState(false);
  const [composing, setComposing] = useState(false);

  const { joined, agentDms, dms, browsable } = useMemo(
    () => ({
      joined: joinedChannels(channels),
      agentDms: agentConversations(channels, users),
      dms: directMessages(channels, users),
      browsable: Object.values(channels)
        .filter((c) => c.membership === null && !c.archivedAt)
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    }),
    [channels, users],
  );

  // Split the same way the conversation list is, so the two sections below can never
  // show the same name twice or lose one between them.
  const { people, agents } = useMemo(() => {
    const active = Object.values(users)
      .filter((u) => u.id !== currentUser?.id && !u.deactivated)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    return {
      people: active.filter((u) => u.kind !== 'bot'),
      agents: active.filter((u) => u.kind === 'bot'),
    };
  }, [users, currentUser]);

  // Which agents are working right now, by display name — that is what a run carries.
  // Only used to draw a pulse, so a name collision costs a dot on the wrong row and
  // nothing else.
  const busyAgents = useMemo(() => {
    const names = new Set<string>();
    for (const run of Object.values(agentRuns)) {
      if (run.status === 'running') names.add(run.agentName);
    }
    return names;
  }, [agentRuns]);

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
    <aside className="sidebar" data-collapsed={collapsed ? 'true' : 'false'}>
      <div className="sidebar-header">
        {/* The workspace mark and name, which the top bar used to carry. Moved here
            because this is where the design puts identity and where the eye starts:
            top-left, above the list of the places inside it. The mark is the initial on
            the accent, so a workspace is recognisable before its name is read — and at
            collapsed width the mark is all that is left, which is the point of it. */}
        <div className="sidebar-identity">
          <span className="workspace-mark" aria-hidden="true">
            {workspaceName.trim().charAt(0).toUpperCase() || 'B'}
          </span>
          {!collapsed && <WorkspaceSwitcher name={workspaceName} />}
        </div>
        {onToggleCollapse && (
          <button
            type="button"
            className="icon-btn sidebar-collapse"
            aria-label={collapsed ? 'Expand left menu' : 'Collapse left menu'}
            aria-pressed={collapsed}
            onClick={onToggleCollapse}
          >
            <ChevronLeftIcon size="md" />
          </button>
        )}
      </div>

      <div className="sidebar-scroll">
        <section className="sidebar-section">
          <SidebarNavButton
            collapsed={collapsed}
            icon={<HomeIcon size="sm" />}
            label="Home"
            active={activeView === 'home'}
            onClick={() => navigate('/')}
          />
          <SidebarNavButton
            collapsed={collapsed}
            icon={<MentionIcon size="sm" />}
            label="Mentions"
            active={activeView === 'activity'}
            onClick={() => navigate('/mentions')}
          />
          <SidebarNavButton
            collapsed={collapsed}
            icon={<ReplyIcon size="sm" />}
            label="Threads"
            active={activeView === 'threads'}
            onClick={() => navigate('/threads')}
          />
          <SidebarNavButton
            collapsed={collapsed}
            icon={<FileIcon size="sm" />}
            label="Tasks"
            active={activeView === 'tasks'}
            onClick={() => navigate('/tasks')}
          />
          <SidebarNavButton
            collapsed={collapsed}
            icon={<PinIcon size="sm" />}
            label="Later"
            active={activeView === 'saved'}
            badge={savedCount > 0 ? String(savedCount) : undefined}
            onClick={() => navigate('/later')}
          />
          <SidebarNavButton
            collapsed={collapsed}
            icon={<ClockIcon size="sm" />}
            label="Scheduled"
            active={activeView === 'scheduled'}
            onClick={() => navigate('/scheduled')}
          />
        </section>

        <section className="sidebar-section">
          {!collapsed && <h2 className="section-label">Channels</h2>}
          {joined.map((channel) => (
            <ChannelRow key={channel.id} channel={channel} collapsed={collapsed} />
          ))}

          <SidebarNavButton
            collapsed={collapsed}
            icon={<SearchIcon size="sm" />}
            label={browsable.length > 0 ? `Browse ${browsable.length} more` : 'Browse channels'}
            active={activeView === 'browse'}
            muted
            onClick={() => navigate('/channels')}
          />

          <button
            className="sidebar-add"
            onClick={() => setCreating(true)}
            aria-label="Create channel"
            title="Create channel"
            data-collapsed={collapsed ? 'true' : 'false'}
          >
            <PlusIcon size="sm" />
            {!collapsed && <span>New channel</span>}
          </button>
        </section>

        {/* Agents, between the channels and the people. Their own heading rather than
            mixed into the direct messages, because "who is in this workspace" reads
            differently when some of them are programs — and because an agent that is
            working right now is worth seeing without opening anything. Hidden entirely
            when a workspace has none, so a server with no model shows no empty shelf. */}
        {agents.length + agentDms.length > 0 && (
          <section className="sidebar-section">
            {!collapsed && <h2 className="section-label">Agents</h2>}
            {agentDms.map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                collapsed={collapsed}
                live={(channel.memberIds ?? []).some((id) =>
                  busyAgents.has(users[id]?.displayName ?? ''),
                )}
              />
            ))}
            {agents
              .filter(
                (agent) =>
                  !agentDms.some((dm) => (dm.memberIds ?? []).includes(agent.id)),
              )
              .map((agent) => (
                <button
                  key={agent.id}
                  className="channel-row"
                  onClick={() => void openDm(agent.id)}
                  title={agent.displayName}
                  aria-label={agent.displayName}
                  data-collapsed={collapsed ? 'true' : 'false'}
                >
                  <AvatarWithPresence user={agent} state={presence[agent.id] ?? 'offline'} />
                  {!collapsed && <span className="channel-name">{agent.displayName}</span>}
                  {busyAgents.has(agent.displayName) && (
                    <span
                      className="agent-live-dot"
                      title={`${agent.displayName} is working`}
                      aria-label={`${agent.displayName} is working`}
                      role="status"
                    />
                  )}
                </button>
              ))}
          </section>
        )}

        <section className="sidebar-section">
          {!collapsed ? (
            <div className="section-label-row">
              <h2 className="section-label">Direct messages</h2>
              <button
                className="sidebar-inline-add"
                onClick={() => setComposing(true)}
                aria-label="New message"
                data-tooltip="New message"
              >
                <PlusIcon size="sm" />
              </button>
            </div>
          ) : (
            <button
              className="sidebar-add"
              onClick={() => setComposing(true)}
              aria-label="New direct message"
              title="New direct message"
              data-collapsed="true"
            >
              <PlusIcon size="sm" />
            </button>
          )}
          {dms.map((channel) => (
            <ChannelRow key={channel.id} channel={channel} collapsed={collapsed} />
          ))}
          {people
            .filter(
              (person) =>
                !dms.some((dm) => dm.kind === 'dm' && (dm.memberIds ?? []).includes(person.id)),
            )
            .map((person) => (
              <button
                key={person.id}
                className="channel-row"
                onClick={() => void openDm(person.id)}
                title={
                  person.statusText
                    ? `${person.displayName} — ${person.statusText}`
                    : person.displayName
                }
                aria-label={person.displayName}
                data-collapsed={collapsed ? 'true' : 'false'}
              >
                <AvatarWithPresence user={person} state={presence[person.id] ?? 'offline'} />
                {!collapsed && (
                  <span className="channel-name">
                    {person.displayName}
                    {person.statusEmoji ? ` ${person.statusEmoji}` : ''}
                  </span>
                )}
              </button>
            ))}
        </section>
      </div>

      {creating && <CreateChannelDialog onClose={() => setCreating(false)} />}
      {composing && <NewMessageDialog onClose={() => setComposing(false)} />}
    </aside>
  );
}

function SidebarNavButton({
  collapsed,
  icon,
  label,
  active,
  badge,
  muted,
  onClick,
}: {
  collapsed: boolean;
  icon: ReactNode;
  label: string;
  active: boolean;
  badge?: string;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="channel-row"
      aria-current={active}
      onClick={onClick}
      title={label}
      aria-label={label}
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <span className="channel-hash" aria-hidden="true">
        {icon}
      </span>
      {!collapsed && <span className={`channel-name${muted ? ' muted' : ''}`}>{label}</span>}
      {badge && <span className="badge badge-quiet">{badge}</span>}
    </button>
  );
}

function ChannelRow({
  channel,
  collapsed,
  live = false,
}: {
  channel: ChannelWithState;
  collapsed: boolean;
  /** This row's agent is mid-run. Draws the pulse; means nothing on a person's row. */
  live?: boolean;
}) {
  const activeChannelId = useStore((s) => s.activeChannelId);
  const currentUserId = useStore((s) => s.currentUser?.id ?? null);
  const users = useStore((s) => s.users);
  const presence = useStore((s) => s.presence);
  const drafts = useStore((s) => s.drafts);
  const channelTitle = useStore((s) => s.channelTitle);
  const [menu, setMenu] = useState(false);

  const active = channel.id === activeChannelId;
  const isDm = channel.kind === 'dm' || channel.kind === 'group_dm';
  const otherId =
    channel.kind === 'dm'
      ? (channel.memberIds ?? []).find((id) => id !== currentUserId)
      : undefined;
  const name = channel.name ?? channelTitle(channel);
  const muted = channel.membership?.notifyLevel === 'none';

  return (
    <div className="channel-row-wrap">
      <button
        className="channel-row"
        aria-current={active}
        data-unread={channel.hasUnread && !active}
        data-muted={muted ? 'true' : undefined}
        data-collapsed={collapsed ? 'true' : 'false'}
        onClick={() => void showChannel(channel.id)}
        title={name}
        aria-label={name}
      >
        {otherId ? (
          <AvatarWithPresence user={users[otherId]} state={presence[otherId] ?? 'offline'} />
        ) : (
          <span className="channel-hash" aria-hidden="true">
            {isDm ? '•' : '#'}
          </span>
        )}
        {!collapsed && <span className="channel-name">{name}</span>}
        {!collapsed && !active && channelHasDraft(drafts, channel.id) && (
          <span className="channel-draft" title="You have an unsent draft here">
            draft
          </span>
        )}
        {channel.mentionCount > 0 && <span className="badge">{channel.mentionCount}</span>}
        {live && (
          <span
            className="agent-live-dot"
            title={`${name} is working`}
            aria-label={`${name} is working`}
            role="status"
          />
        )}
      </button>
      {!collapsed && (
        <button
          type="button"
          className="channel-kebab"
          aria-label={`Options for ${name}`}
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={(event) => {
            event.stopPropagation();
            setMenu(true);
          }}
        >
          ···
        </button>
      )}
      {menu && (
        <ChannelMenu
          channel={channel}
          onClose={() => setMenu(false)}
          onOpenDetails={() => {
            setMenu(false);
            void showChannel(channel.id);
          }}
        />
      )}
    </div>
  );
}
