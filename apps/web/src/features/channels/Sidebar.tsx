/** Channel and DM navigation. */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ChannelWithState, SidebarSection } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { showError } from '../../lib/toasts.ts';
import { navigate, parseRoute, usePath } from '../../lib/router.ts';
import { useStore } from '../../lib/store.ts';
import { useBusyAgentNames } from '../../lib/useRuns.ts';
import { showChannel } from '../../lib/navigation.ts';
import { channelHasDraft } from '../../lib/drafts.ts';
import {
  agentConversations,
  agentIsAvailable,
  directMessages,
  joinedChannels,
} from '../../lib/conversations.ts';
import { AvatarWithPresence } from '../../components/Avatar.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { Menu } from '../../components/Menu.tsx';
import { removeSection, sectioned, toggleCollapsed } from '../../lib/sidebarSections.ts';
import { RenameSectionDialog } from './SectionDialogs.tsx';
import {
  ChevronDownIcon,
  ClockIcon,
  DraftIcon,
  FileIcon,
  HomeIcon,
  HuddleIcon,
  MentionIcon,
  PinIcon,
  DecisionIcon,
  PlusIcon,
  ReplyIcon,
  SearchIcon,
  SparkIcon,
  VideoIcon,
} from '../../components/Icon.tsx';
import { CreateChannelDialog } from './CreateChannelDialog.tsx';
import { NewMessageDialog } from './NewMessageDialog.tsx';
import { ChannelMenu } from './ChannelMenu.tsx';
import { DialogPresence } from '../../components/Dialog.tsx';
import { byDisplayName } from '../../lib/format.ts';
import { FALLBACK_MS } from '../../lib/usePresence.ts';

interface SidebarProps {
  collapsed?: boolean;
}

const NO_SECTIONS: SidebarSection[] = [];

export function Sidebar({ collapsed = false }: SidebarProps = {}) {
  const channels = useStore((s) => s.channels);
  const users = useStore((s) => s.users);
  const presence = useStore((s) => s.presence);
  const currentUser = useStore((s) => s.currentUser);
  const isGuest = currentUser?.role === 'guest';
  const activeView = parseRoute(usePath()).view;
  const savedCount = useStore((s) => s.savedMessageIds.size);
  // A number, so typing in a composer re-renders the sidebar only when one appears or goes.
  const draftCount = useStore(
    (s) => Object.values(s.drafts).filter((draft) => draft.body.trim() !== '').length,
  );
  // Which agents are working right now, by display name — that is what a run carries.
  // Only used to draw a pulse, so a name collision costs a dot on the wrong row and
  // nothing else. Selected as names, so a running card's snapshots do not redraw the
  // sidebar four times a second.
  const busyAgents = useBusyAgentNames();

  const [creating, setCreating] = useState(false);
  const [composing, setComposing] = useState(false);
  // Your own sections (M3 · B3) come first, and what is in one leaves the lists below.
  const sections = useStore((s) => s.currentUser?.prefs?.sidebarSections ?? NO_SECTIONS);
  const inSections = useMemo(() => sectioned(sections), [sections]);

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
  const arrivals = useArrivals([...joined, ...agentDms, ...dms]);
  const isAgentDm = (channel: ChannelWithState) =>
    (channel.memberIds ?? []).some((id) => users[id]?.kind === 'bot');

  // Split the same way the conversation list is, so the two sections below can never
  // show the same name twice or lose one between them.
  const { people, agents } = useMemo(() => {
    const active = Object.values(users)
      .filter((u) => u.id !== currentUser?.id && !u.deactivated)
      .sort(byDisplayName);
    return {
      people: active.filter((u) => u.kind !== 'bot'),
      // An agent whose app is uninstalled or switched off answers nothing, so listing it
      // here offers a conversation that cannot happen. `agentIsAvailable` is the same
      // test `conversations.ts` applies to the agent DMs, so the two halves of this one
      // section cannot disagree about who is here.
      agents: active.filter((u) => u.kind === 'bot' && agentIsAvailable(u)),
    };
  }, [users, currentUser]);

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
      {/* No header. Identity lives in the top bar, and so does the control that collapses
          this column — a band up here holding one chevron cost the list a header's height
          and read as empty space above it. The list starts where the column starts. */}
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
            icon={<DecisionIcon size="sm" />}
            label="Decisions"
            active={activeView === 'decisions'}
            onClick={() => navigate('/decisions')}
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
          {/* Shown while there is something unsent, as Slack keeps "Drafts & sent" quiet
              until it has something in it (ADR 0037). */}
          {draftCount > 0 && (
            <SidebarNavButton
              collapsed={collapsed}
              icon={<DraftIcon size="sm" />}
              label="Drafts"
              active={activeView === 'drafts'}
              badge={String(draftCount)}
              onClick={() => navigate('/drafts')}
            />
          )}
        </section>

        {sections.map((section) => (
          <SectionGroup
            key={section.id}
            section={section}
            sections={sections}
            collapsed={collapsed}
            live={(channel) =>
              isAgentDm(channel) &&
              (channel.memberIds ?? []).some((id) =>
                busyAgents.has(users[id]?.displayName ?? ''),
              )
            }
            arriving={arrivals.arriving}
            onArrived={arrivals.settle}
          />
        ))}

        <section className="sidebar-section">
          {!collapsed && <h2 className="section-label">Channels</h2>}
          {joined.filter((channel) => !inSections.has(channel.id)).map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              collapsed={collapsed}
              arriving={arrivals.arriving(channel.id)}
              onArrived={arrivals.settle}
            />
          ))}

          {/* A guest is in the channels they were invited to and makes no others: there
              is nothing to browse and nowhere new to start (ADR 0034). */}
          {!isGuest && (
            <SidebarNavButton
              collapsed={collapsed}
              icon={<SearchIcon size="sm" />}
              label={browsable.length > 0 ? `Browse ${browsable.length} more` : 'Browse channels'}
              active={activeView === 'browse'}
              muted
              onClick={() => navigate('/channels')}
            />
          )}

          {!isGuest && (
            <button
              className="sidebar-add"
              onClick={() => setCreating(true)}
              aria-label={collapsed ? 'New channel' : undefined}
              title="New channel"
              data-collapsed={collapsed ? 'true' : 'false'}
            >
              <PlusIcon size="sm" />
              {!collapsed && <span>New channel</span>}
            </button>
          )}
        </section>

        {/* Agents, between the channels and the people. Their own heading rather than
            mixed into the direct messages, because "who is in this workspace" reads
            differently when some of them are programs — and because an agent that is
            working right now is worth seeing without opening anything. Hidden entirely
            when a workspace has none, so a server with no model shows no empty shelf. */}
        {!isGuest && agents.length + agentDms.length > 0 && (
          <section className="sidebar-section">
            {!collapsed && (
              <div className="section-label-row">
                <h2 className="section-label">Agents</h2>
                <button
                  className="sidebar-inline-add"
                  onClick={() => navigate('/agents')}
                  aria-label="All agents"
                  aria-current={activeView === 'agents' ? 'page' : undefined}
                  data-tooltip="All agents"
                  data-tooltip-align="end"
                >
                  <SparkIcon size="sm" />
                </button>
              </div>
            )}
            {agentDms.filter((channel) => !inSections.has(channel.id)).map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                collapsed={collapsed}
                live={(channel.memberIds ?? []).some((id) =>
                  busyAgents.has(users[id]?.displayName ?? ''),
                )}
                arriving={arrivals.arriving(channel.id)}
                onArrived={arrivals.settle}
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
                  aria-label={collapsed ? agent.displayName : undefined}
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
                data-tooltip-align="end"
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
          {dms.filter((channel) => !inSections.has(channel.id)).map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              collapsed={collapsed}
              arriving={arrivals.arriving(channel.id)}
              onArrived={arrivals.settle}
            />
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
                aria-label={collapsed ? person.displayName : undefined}
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

      <DialogPresence when={creating}>
        {() => <CreateChannelDialog onClose={() => setCreating(false)} />}
      </DialogPresence>
      <DialogPresence when={composing}>
        {() => <NewMessageDialog onClose={() => setComposing(false)} />}
      </DialogPresence>
    </aside>
  );
}

/**
 * The conversations that joined the list while it was on screen.
 *
 * A row slides in when you create a channel, join one, open a DM or are added somewhere
 * — and not at start-up, and not when the sidebar mounts again after the console, when
 * every row would otherwise arrive at once. So whatever the list held on its first
 * render is simply there, and anything after is an arrival until its entrance ends.
 */
function useArrivals(conversations: readonly ChannelWithState[]) {
  const [known, setKnown] = useState<ReadonlySet<string>>(
    () => new Set(conversations.map((channel) => channel.id)),
  );
  const settle = useCallback((id: string) => {
    setKnown((current) => (current.has(id) ? current : new Set(current).add(id)));
  }, []);
  return { arriving: (id: string) => !known.has(id), settle };
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
      // Named by its own text when there is text. An `aria-label` that repeats the
      // label drops whatever sits beside it — the unread count on Later, the draft
      // mark on a channel — from the name a screen reader reads out, and makes the
      // accessible name disagree with what everyone else sees.
      aria-label={collapsed ? label : undefined}
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <span className="channel-hash" aria-hidden="true">
        {icon}
      </span>
      {!collapsed && <span className={`channel-name${muted ? ' muted' : ''}`}>{label}</span>}
      {/* Keyed by the count so a change re-mounts it and it pops; the same count on an
          unrelated re-render is the same node and sits still. */}
      {badge && (
        <span key={badge} className="badge badge-quiet">
          {badge}
        </span>
      )}
    </button>
  );
}

function ChannelRow({
  channel,
  collapsed,
  live = false,
  arriving = false,
  onArrived,
}: {
  channel: ChannelWithState;
  collapsed: boolean;
  /** This row's agent is mid-run. Draws the pulse; means nothing on a person's row. */
  live?: boolean;
  /** New to the list since it was drawn: slide in, once. */
  arriving?: boolean;
  /** The entrance is over — or, on the fallback, never came. */
  onArrived?: (id: string) => void;
}) {
  const activeChannelId = useStore((s) => s.activeChannelId);
  const currentUserId = useStore((s) => s.currentUser?.id ?? null);
  const users = useStore((s) => s.users);
  const presence = useStore((s) => s.presence);
  const drafts = useStore((s) => s.drafts);
  const channelTitle = useStore((s) => s.channelTitle);
  const [menu, setMenu] = useState(false);

  // A primitive, not the calls themselves, so this row re-renders only when its own
  // marks change — a call starting or ending elsewhere in the workspace touches no
  // row but its own.
  const liveKinds = useStore((s) => {
    let kinds = '';
    for (const call of Object.values(s.activeCalls)) {
      if (call.channelId === channel.id) kinds += call.kind === 'meetup' ? 'm' : 'h';
    }
    return kinds;
  });

  const active = channel.id === activeChannelId;
  const isDm = channel.kind === 'dm' || channel.kind === 'group_dm';
  const otherId =
    channel.kind === 'dm'
      ? (channel.memberIds ?? []).find((id) => id !== currentUserId)
      : undefined;
  const name = channel.name ?? channelTitle(channel);
  const muted = channel.membership?.notifyLevel === 'none';

  // The floor under the entrance, as `usePresence` has one under an exit: a sidebar in a
  // background tab plays nothing, and the row must not stay "arriving" until it does.
  useEffect(() => {
    if (!arriving) return undefined;
    const timer = window.setTimeout(() => onArrived?.(channel.id), FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [arriving, onArrived, channel.id]);

  return (
    <div
      className="channel-row-wrap"
      data-arriving={arriving ? 'true' : undefined}
      onAnimationEnd={(event) => {
        if (arriving && event.target === event.currentTarget) onArrived?.(channel.id);
      }}
    >
      <button
        className="channel-row"
        aria-current={active}
        data-unread={channel.hasUnread && !active}
        data-muted={muted ? 'true' : undefined}
        data-collapsed={collapsed ? 'true' : 'false'}
        onClick={() => void showChannel(channel.id)}
        title={name}
        aria-label={collapsed ? name : undefined}
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
        {liveKinds && (
          <span
            className="channel-call-mark"
            role="img"
            aria-label={liveKinds.includes('m') ? 'A meetup is on' : 'A huddle is on'}
            title={liveKinds.includes('m') ? 'A meetup is on' : 'A huddle is on'}
          >
            {liveKinds.includes('m') ? <VideoIcon size="sm" /> : <HuddleIcon size="sm" />}
          </span>
        )}
        {channel.mentionCount > 0 && (
          <span key={channel.mentionCount} className="badge">
            {channel.mentionCount}
          </span>
        )}
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

/** One of your own sections (M3 · B3): its name folds it, its menu renames or deletes it.
 *  Folded, it still shows what needs you — an unread conversation and the one you are
 *  in — the way Slack keeps a collapsed section's unread rows. */
function SectionGroup({
  section,
  sections,
  collapsed,
  live,
  arriving,
  onArrived,
}: {
  section: SidebarSection;
  sections: SidebarSection[];
  /** The sidebar is a rail of icons: rows only, no heading. */
  collapsed: boolean;
  live: (channel: ChannelWithState) => boolean;
  arriving: (id: string) => boolean;
  onArrived: (id: string) => void;
}) {
  const channels = useStore((s) => s.channels);
  const activeChannelId = useStore((s) => s.activeChannelId);
  const channelTitle = useStore((s) => s.channelTitle);
  const setSidebarSections = useStore((s) => s.setSidebarSections);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const conversations = section.channelIds
    .map((id) => channels[id])
    .filter(
      (channel): channel is ChannelWithState =>
        channel !== undefined && channel.membership !== null && !channel.archivedAt,
    )
    .sort((a, b) => channelTitle(a).localeCompare(channelTitle(b)));
  const shown = section.collapsed
    ? conversations.filter(
        (channel) =>
          channel.id === activeChannelId || channel.hasUnread || channel.mentionCount > 0,
      )
    : conversations;

  return (
    <section className="sidebar-section" aria-label={section.name}>
      {!collapsed && (
        <div className="section-label-row section-head">
          <button
            type="button"
            className="section-toggle"
            aria-expanded={!section.collapsed}
            onClick={() => void setSidebarSections(toggleCollapsed(sections, section.id))}
          >
            <ChevronDownIcon size="sm" />
            <span className="section-label">{section.name}</span>
          </button>
          <button
            type="button"
            className="channel-kebab section-kebab"
            aria-label={`Options for ${section.name}`}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu(true)}
          >
            ···
          </button>
          <Menu
            open={menu}
            onClose={() => setMenu(false)}
            className="menu"
            suspendDismiss={renaming || deleting}
          >
            <button
              className="menu-item"
              role="menuitem"
              onClick={() => {
                setMenu(false);
                setRenaming(true);
              }}
            >
              <span className="menu-check" aria-hidden="true" />
              Rename section…
            </button>
            <button
              className="menu-item menu-item-danger"
              role="menuitem"
              onClick={() => {
                setMenu(false);
                setDeleting(true);
              }}
            >
              <span className="menu-check" aria-hidden="true" />
              Delete section
            </button>
          </Menu>
        </div>
      )}
      {shown.map((channel) => (
        <ChannelRow
          key={channel.id}
          channel={channel}
          collapsed={collapsed}
          live={live(channel)}
          arriving={arriving(channel.id)}
          onArrived={onArrived}
        />
      ))}
      {!collapsed && !section.collapsed && conversations.length === 0 && (
        <p className="section-empty">Move a conversation here from its ··· menu.</p>
      )}

      <DialogPresence when={renaming}>
        {() => <RenameSectionDialog section={section} onClose={() => setRenaming(false)} />}
      </DialogPresence>
      <DialogPresence when={deleting}>
        {() => (
          <ConfirmDialog
            title={`Delete “${section.name}”?`}
            body="Its conversations go back to where they were. Only the section goes."
            confirmLabel="Delete section"
            danger
            onClose={() => setDeleting(false)}
            onConfirm={() => {
              setDeleting(false);
              void setSidebarSections(removeSection(sections, section.id));
            }}
          />
        )}
      </DialogPresence>
    </section>
  );
}
