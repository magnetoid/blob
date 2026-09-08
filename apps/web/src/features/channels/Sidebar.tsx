/** Channel and DM navigation. */

import { useMemo, useState, type ReactNode } from 'react';
import type { ChannelWithState } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { showError } from '../../lib/toasts.ts';
import { navigate, parseRoute, pathForRoute, usePath } from '../../lib/router.ts';
import { useStore } from '../../lib/store.ts';
import { showChannel } from '../../lib/navigation.ts';
import { channelHasDraft } from '../../lib/drafts.ts';
import { directMessages, joinedChannels } from '../../lib/conversations.ts';
import { Avatar, AvatarWithPresence } from '../../components/Avatar.tsx';
import { Menu } from '../../components/Menu.tsx';
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ClockIcon,
  FeedbackIcon,
  FileIcon,
  HomeIcon,
  MentionIcon,
  PinIcon,
  PlusIcon,
  ReplyIcon,
  SearchIcon,
  SettingsIcon,
  MembersIcon,
} from '../../components/Icon.tsx';
import { CreateChannelDialog } from './CreateChannelDialog.tsx';
import { NewMessageDialog } from './NewMessageDialog.tsx';
import { ITEMS } from '../shell/menu.ts';
import { hasUnseenRelease } from '../../lib/changelog.ts';

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onFeedback?: () => void;
}

export function Sidebar({
  collapsed = false,
  onToggleCollapse,
  onFeedback,
}: SidebarProps = {}) {
  const channels = useStore((s) => s.channels);
  const users = useStore((s) => s.users);
  const presence = useStore((s) => s.presence);
  const currentUser = useStore((s) => s.currentUser);
  const activeView = parseRoute(usePath()).view;
  const savedCount = useStore((s) => s.savedMessageIds.size);
  const status = useStore((s) => s.status);

  const [creating, setCreating] = useState(false);
  const [composing, setComposing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [unseenRelease, setUnseenRelease] = useState(hasUnseenRelease);

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
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'owner';
  const isOwner = currentUser?.role === 'owner';
  const visibleMenuItems = ITEMS.filter(
    (item) => (!item.adminOnly || isAdmin) && (!item.ownerOnly || isOwner),
  );

  async function openDm(userId: string) {
    try {
      const { channel } = await api.dms.open([userId]);
      useStore.setState((s) => ({ channels: { ...s.channels, [channel.id]: channel } }));
      await showChannel(channel.id);
    } catch (err) {
      showError(err);
    }
  }

  const utilityActions = [
    {
      id: 'preferences',
      label: 'Preferences',
      icon: <SettingsIcon size="sm" />,
      onClick: () => navigate(pathForRoute({ view: 'settings', section: 'preferences' })),
      active: activeView === 'settings',
    },
    ...(isAdmin
      ? [
          {
            id: 'console',
            label: 'Workspace',
            icon: <MembersIcon size="sm" />,
            onClick: () => navigate(pathForRoute({ view: 'admin', section: 'general' })),
            active: activeView === 'admin',
          },
        ]
      : []),
    {
      id: 'feedback',
      label: 'Feedback',
      icon: <FeedbackIcon size="sm" />,
      onClick: () => onFeedback?.(),
      active: false,
    },
  ];

  return (
    <aside className="sidebar" data-collapsed={collapsed ? 'true' : 'false'}>
      <div className="sidebar-header">
        <div className="sidebar-header-copy">
          {!collapsed && (
            <>
              <div className="sidebar-kicker">Navigate</div>
              <div className="workspace-meta">{memberCount} members</div>
            </>
          )}
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
            label="Activity"
            active={activeView === 'activity'}
            onClick={() => navigate('/activity')}
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
                title={person.displayName}
                aria-label={person.displayName}
                data-collapsed={collapsed ? 'true' : 'false'}
              >
                <AvatarWithPresence user={person} state={presence[person.id] ?? 'offline'} />
                {!collapsed && <span className="channel-name">{person.displayName}</span>}
              </button>
            ))}
        </section>
      </div>

      {currentUser && (
        <div className="sidebar-footer">
          <div className="sidebar-footer-actions">
            {utilityActions.map((action) => (
              <button
                key={action.id}
                type="button"
                className="sidebar-utility-btn"
                aria-label={action.label}
                aria-pressed={action.active}
                title={action.label}
                onClick={action.onClick}
              >
                {action.icon}
                {!collapsed && <span>{action.label}</span>}
              </button>
            ))}
          </div>

          <div className="sidebar-account">
            <button
              type="button"
              className="sidebar-account-trigger"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              onClick={() => setMenuOpen((open) => !open)}
              title={currentUser.displayName}
            >
              <span className="sidebar-account-avatar">
                <Avatar user={currentUser} size="sm" />
                <span
                  className="presence-dot"
                  data-state={status === 'online' ? 'active' : 'offline'}
                  title={status === 'online' ? 'Connected' : 'Reconnecting…'}
                />
              </span>
              {!collapsed && (
                <>
                  <span className="sidebar-account-copy">
                    <span className="sidebar-account-name">{currentUser.displayName}</span>
                    <span className="sidebar-account-role">
                      {currentUser.role === 'owner'
                        ? 'Owner'
                        : currentUser.role === 'admin'
                          ? 'Admin'
                          : 'Member'}
                    </span>
                  </span>
                  {unseenRelease && <span className="menu-dot" aria-hidden="true" />}
                  <ChevronDownIcon size="sm" />
                </>
              )}
            </button>

            <Menu open={menuOpen} onClose={() => setMenuOpen(false)} className="user-menu-panel">
              <div className="user-menu-header">
                <div className="user-menu-header-name">{currentUser.displayName}</div>
                <div className="user-menu-header-email">{currentUser.email}</div>
              </div>

              {visibleMenuItems.map((item) =>
                item.soon ? (
                  <button
                    key={item.label}
                    className="user-menu-item"
                    role="menuitem"
                    disabled
                    title="Not built yet"
                  >
                    {item.label}
                    <span className="user-menu-soon">Soon</span>
                  </button>
                ) : (
                  <button
                    key={item.label}
                    className="user-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      if (item.path === '/whats-new') setUnseenRelease(false);
                      if (item.action === 'feedback') onFeedback?.();
                      else navigate(item.path as string);
                    }}
                  >
                    {item.label}
                    {item.path === '/whats-new' && unseenRelease && (
                      <span className="menu-dot" aria-label="New since you last looked" />
                    )}
                  </button>
                ),
              )}
            </Menu>
          </div>
        </div>
      )}

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

function ChannelRow({ channel, collapsed }: { channel: ChannelWithState; collapsed: boolean }) {
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
  const name = channel.name ?? channelTitle(channel);

  return (
    <button
      className="channel-row"
      aria-current={active}
      data-unread={channel.hasUnread && !active}
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
    </button>
  );
}
