/** Channel and DM navigation: the channel list, on shadcn's Sidebar.
 *
 * A column beside the view from 768px, folded to a rail of icons on request, and below it
 * a Sheet that the top bar's list trigger opens — the sidebar's three states are its own
 * (`components/ui/sidebar.tsx`), and the shell provides it. The rows are its menu buttons
 * and the headings its group labels; what a row says about its conversation — unread,
 * muted, current, a call on, a draft waiting — is on the row as data, and the styling reads
 * that.
 *
 * Two things here are the list's rather than the component's. A row that joins the list
 * while it is on screen slides in, once, and the list it was drawn with does not
 * (`useArrivals`). And a count is keyed by its number, so the badge pops when the number
 * moves and sits still when an unrelated update re-renders the row.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ChannelWithState, SidebarSection } from '@blob/shared';
import { cn } from 'cn';
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
import {
  Sidebar as SidebarFrame,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '../../components/ui/sidebar.tsx';
import { sectioned, toggleCollapsed } from '../../lib/sidebarSections.ts';
import {
  ActivityIcon,
  ChevronDownIcon,
  ClockIcon,
  DecisionIcon,
  DraftIcon,
  FileIcon,
  HomeIcon,
  HuddleIcon,
  LockIcon,
  MentionIcon,
  MoreIcon,
  PinIcon,
  PlusIcon,
  ReplyIcon,
  SearchIcon,
  SparkIcon,
  TaskIcon,
  VideoIcon,
} from '../../components/Icon.tsx';
import { CreateChannelDialog } from './CreateChannelDialog.tsx';
import { NewMessageDialog } from './NewMessageDialog.tsx';
import { ChannelMenu, SectionMenu } from './lazyMenus.ts';
import { DialogPresence } from '../../components/Dialog.tsx';
import { byDisplayName } from '../../lib/format.ts';
import { FALLBACK_MS } from '../../lib/usePresence.ts';

const NO_SECTIONS: SidebarSection[] = [];

/**
 * A row on the ground: the Meadow washes for hover, press and the row you are on, which are
 * mixed against whatever the ground is (`--ground-*`), and the accent for where you are.
 * Unread is weight, as in Slack. On the rail a row is a 44px square, its icon centred by
 * the button's own alignment.
 */
const ROW = cn(
  'text-sidebar-foreground transition-[width,height,padding,background-color,color,translate,scale] duration-(--dur-fast)',
  'hover:translate-x-(--motion-slide) hover:bg-(--ground-hover) hover:text-sidebar-foreground',
  'active:scale-(--motion-press) active:bg-(--ground-press) active:text-sidebar-foreground',
  'data-active:bg-(--ground-selected) data-active:font-semibold data-active:text-(--blob-accent)',
  'data-active:hover:bg-(--ground-selected) data-active:hover:text-(--blob-accent)',
  'data-[unread=true]:font-semibold',
  'group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-11! group-data-[collapsible=icon]:justify-center',
);

/** A count beside a row: the accent for what names you, and clay for what is only waiting —
 *  the things you put aside are a reminder, not an alert, and must not read as a mention. */
const BADGE = cn(
  'static h-[18px] min-w-[18px] translate-y-0 rounded-full px-[5px] text-(length:--text-2xs) font-bold',
  // Keyed by its count, so a new number is a new node and this plays once.
  'animate-[badge-pop_var(--dur-fast)_var(--blob-ease-out)]',
  // On the rail it stays, smaller, in the row's corner.
  'group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:h-3.5 group-data-[collapsible=icon]:min-w-3.5 group-data-[collapsible=icon]:px-1',
);
const BADGE_TONE = {
  mention:
    'bg-(--blob-accent) text-(--blob-accent-contrast) peer-hover/menu-button:text-(--blob-accent-contrast) peer-data-active/menu-button:text-(--blob-accent-contrast)',
  quiet:
    'bg-(--clay) text-(--clay-text) peer-hover/menu-button:text-(--clay-text) peer-data-active/menu-button:text-(--clay-text)',
};

export function Sidebar() {
  const channels = useStore((s) => s.channels);
  const users = useStore((s) => s.users);
  const presence = useStore((s) => s.presence);
  const currentUser = useStore((s) => s.currentUser);
  const activeChannelId = useStore((s) => s.activeChannelId);
  const workspaceName = useStore((s) => s.workspaceName);
  const isGuest = currentUser?.role === 'guest';
  const path = usePath();
  const route = parseRoute(path);
  const activeView = route.view;
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

  const { isMobile, state, setOpenMobile } = useSidebar();
  // Folded to the rail: a desk's choice. Below 768px the list is a Sheet and always whole.
  const folded = !isMobile && state === 'collapsed';

  // The Sheet is for getting somewhere: arriving anywhere else closes it, whatever took
  // you there — a row here, ⌘K over it, a channel just created.
  useEffect(() => {
    setOpenMobile(false);
  }, [path, activeChannelId, setOpenMobile]);

  /** Go somewhere from the list, closing the Sheet it may be in on the way. */
  const go = (to: string) => {
    setOpenMobile(false);
    navigate(to);
  };

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
    setOpenMobile(false);
    try {
      const { channel } = await api.dms.open([userId]);
      useStore.setState((s) => ({ channels: { ...s.channels, [channel.id]: channel } }));
      await showChannel(channel.id);
    } catch (err) {
      showError(err);
    }
  }

  const place = (
    to: string,
    label: string,
    icon: ReactNode,
    active: boolean,
    badge?: { count: number; tone: keyof typeof BADGE_TONE },
  ) => (
    <PlaceRow
      key={to}
      label={label}
      icon={icon}
      active={active}
      folded={folded}
      badge={badge}
      onSelect={() => go(to)}
    />
  );

  return (
    <>
      <SidebarFrame
        variant="inset"
        collapsible="icon"
        label="Channel list"
        closeLabel="Close channel list"
        // In its own cell of the shell's grid (`styles/app/shell.css`), not fixed to the
        // window as the generated sidebar is: a call's bar has the cell below it, and a
        // fixed column would cover it.
        className="absolute inset-y-0 h-auto transition-none"
      >
        {/* A header in the Sheet alone. Beside the view the top bar is above the list and
            says whose workspace this is, and the control that folds the column is there
            too — a band here would be empty space. A Sheet covers the bar, and its close
            button needs a row of its own: without one it sat on top of Home. The band is
            as tall as that button, which is 44px under a coarse pointer, and leaves it the
            end of the row. */}
        {isMobile && (
          <SidebarHeader className="min-h-13 flex-row items-center gap-2 py-3 ps-4 pe-12 pointer-coarse:min-h-17 pointer-coarse:pe-16">
            <span
              aria-hidden="true"
              className="grid size-6 flex-none place-items-center rounded-(--blob-radius-md) bg-(--blob-accent) text-(length:--blob-text-base) leading-none font-bold text-(--blob-accent-contrast) select-none"
            >
              {workspaceName.trim().charAt(0).toUpperCase() || 'B'}
            </span>
            <span className="min-w-0 truncate text-(length:--text-title) font-bold text-sidebar-foreground">
              {workspaceName}
            </span>
          </SidebarHeader>
        )}
        <nav aria-label="Channel list" className="flex min-h-0 flex-1 flex-col">
          <SidebarContent className="pb-4 group-data-[collapsible=icon]:overflow-y-auto">
            <SidebarGroup className="px-1">
              <SidebarMenu>
                {place('/', 'Home', <HomeIcon size="sm" />, activeView === 'home')}
                {place(
                  '/activity',
                  'Activity',
                  <ActivityIcon size="sm" />,
                  route.view === 'activity' && route.kind !== 'mention',
                )}
                {place(
                  '/mentions',
                  'Mentions',
                  <MentionIcon size="sm" />,
                  route.view === 'activity' && route.kind === 'mention',
                )}
                {place('/threads', 'Threads', <ReplyIcon size="sm" />, activeView === 'threads')}
                {place('/tasks', 'Tasks', <TaskIcon size="sm" />, activeView === 'tasks')}
                {place(
                  '/decisions',
                  'Decisions',
                  <DecisionIcon size="sm" />,
                  activeView === 'decisions',
                )}
                {place(
                  '/later',
                  'Later',
                  <PinIcon size="sm" />,
                  activeView === 'saved',
                  savedCount > 0 ? { count: savedCount, tone: 'quiet' } : undefined,
                )}
                {place('/files', 'Files', <FileIcon size="sm" />, activeView === 'files')}
                {place(
                  '/scheduled',
                  'Scheduled',
                  <ClockIcon size="sm" />,
                  activeView === 'scheduled',
                )}
                {/* Shown while there is something unsent, as Slack keeps "Drafts & sent"
                    quiet until it has something in it (ADR 0037). */}
                {draftCount > 0 &&
                  place('/drafts', 'Drafts', <DraftIcon size="sm" />, activeView === 'drafts', {
                    count: draftCount,
                    tone: 'quiet',
                  })}
              </SidebarMenu>
            </SidebarGroup>

            {sections.map((section) => (
              <SectionGroup
                key={section.id}
                section={section}
                sections={sections}
                folded={folded}
                live={(channel) =>
                  isAgentDm(channel) &&
                  (channel.memberIds ?? []).some((id) =>
                    busyAgents.has(users[id]?.displayName ?? ''),
                  )
                }
                arriving={arrivals.arriving}
                onArrived={arrivals.settle}
                onLeave={() => setOpenMobile(false)}
              />
            ))}

            <SidebarGroup className="px-1">
              {!folded && (
                // The label is the heading's content; `render` only names the element.
                // eslint-disable-next-line jsx-a11y/heading-has-content
                <SidebarGroupLabel render={<h2 />} className="text-muted-foreground">
                  Channels
                </SidebarGroupLabel>
              )}
              <SidebarMenu>
                {joined
                  .filter((channel) => !inSections.has(channel.id))
                  .map((channel) => (
                    <ChannelRow
                      key={channel.id}
                      channel={channel}
                      folded={folded}
                      arriving={arrivals.arriving(channel.id)}
                      onArrived={arrivals.settle}
                      onLeave={() => setOpenMobile(false)}
                    />
                  ))}

                {/* A guest is in the channels they were invited to and makes no others:
                    there is nothing to browse and nowhere new to start (ADR 0034). */}
                {!isGuest && (
                  <PlaceRow
                    label={
                      browsable.length > 0 ? `Browse ${browsable.length} more` : 'Browse channels'
                    }
                    icon={<SearchIcon size="sm" />}
                    active={activeView === 'browse'}
                    folded={folded}
                    // A quiet row; the accent, like any current row, when it is the page
                    // you are on.
                    muted
                    onSelect={() => go('/channels')}
                  />
                )}
                {!isGuest && (
                  <ActionRow
                    label="New channel"
                    icon={<PlusIcon size="sm" />}
                    folded={folded}
                    onSelect={() => setCreating(true)}
                  />
                )}
              </SidebarMenu>
            </SidebarGroup>

            {/* Agents, between the channels and the people. Their own heading rather than
                mixed into the direct messages, because "who is in this workspace" reads
                differently when some of them are programs — and because an agent that is
                working right now is worth seeing without opening anything. Hidden entirely
                when a workspace has none, so a server with no model shows no empty shelf. */}
            {!isGuest && agents.length + agentDms.length > 0 && (
              <SidebarGroup className="px-1">
                {!folded && (
                  <>
                    {/* eslint-disable-next-line jsx-a11y/heading-has-content */}
                    <SidebarGroupLabel render={<h2 />} className="text-muted-foreground">
                      Agents
                    </SidebarGroupLabel>
                    <SidebarGroupAction
                      onClick={() => go('/agents')}
                      aria-label="All agents"
                      aria-current={activeView === 'agents' ? 'page' : undefined}
                      data-tooltip="All agents"
                      data-tooltip-align="end"
                      className="text-muted-foreground hover:bg-(--ground-hover) hover:text-sidebar-foreground"
                    >
                      <SparkIcon size="sm" />
                    </SidebarGroupAction>
                  </>
                )}
                <SidebarMenu>
                  {folded && (
                    <ActionRow
                      label="All agents"
                      icon={<SparkIcon size="sm" />}
                      folded
                      active={activeView === 'agents'}
                      onSelect={() => go('/agents')}
                    />
                  )}
                  {agentDms
                    .filter((channel) => !inSections.has(channel.id))
                    .map((channel) => (
                      <ChannelRow
                        key={channel.id}
                        channel={channel}
                        folded={folded}
                        live={(channel.memberIds ?? []).some((id) =>
                          busyAgents.has(users[id]?.displayName ?? ''),
                        )}
                        arriving={arrivals.arriving(channel.id)}
                        onArrived={arrivals.settle}
                        onLeave={() => setOpenMobile(false)}
                      />
                    ))}
                  {agents
                    .filter(
                      (agent) => !agentDms.some((dm) => (dm.memberIds ?? []).includes(agent.id)),
                    )
                    .map((agent) => (
                      <PersonRow
                        key={agent.id}
                        name={agent.displayName}
                        title={agent.displayName}
                        avatar={
                          <AvatarWithPresence
                            user={agent}
                            state={presence[agent.id] ?? 'offline'}
                          />
                        }
                        folded={folded}
                        live={busyAgents.has(agent.displayName)}
                        onSelect={() => void openDm(agent.id)}
                      />
                    ))}
                </SidebarMenu>
              </SidebarGroup>
            )}

            <SidebarGroup className="px-1">
              {!folded && (
                <>
                  {/* eslint-disable-next-line jsx-a11y/heading-has-content */}
                  <SidebarGroupLabel render={<h2 />} className="text-muted-foreground">
                    Direct messages
                  </SidebarGroupLabel>
                  <SidebarGroupAction
                    onClick={() => setComposing(true)}
                    aria-label="New message"
                    data-tooltip="New message"
                    data-tooltip-align="end"
                    className="text-muted-foreground hover:bg-(--ground-hover) hover:text-sidebar-foreground"
                  >
                    <PlusIcon size="sm" />
                  </SidebarGroupAction>
                </>
              )}
              <SidebarMenu>
                {folded && (
                  <ActionRow
                    label="New direct message"
                    icon={<PlusIcon size="sm" />}
                    folded
                    onSelect={() => setComposing(true)}
                  />
                )}
                {dms
                  .filter((channel) => !inSections.has(channel.id))
                  .map((channel) => (
                    <ChannelRow
                      key={channel.id}
                      channel={channel}
                      folded={folded}
                      arriving={arrivals.arriving(channel.id)}
                      onArrived={arrivals.settle}
                      onLeave={() => setOpenMobile(false)}
                    />
                  ))}
                {people
                  .filter(
                    (person) =>
                      !dms.some(
                        (dm) => dm.kind === 'dm' && (dm.memberIds ?? []).includes(person.id),
                      ),
                  )
                  .map((person) => (
                    <PersonRow
                      key={person.id}
                      name={`${person.displayName}${person.statusEmoji ? ` ${person.statusEmoji}` : ''}`}
                      label={person.displayName}
                      title={
                        person.statusText
                          ? `${person.displayName} — ${person.statusText}`
                          : person.displayName
                      }
                      avatar={
                        <AvatarWithPresence
                          user={person}
                          state={presence[person.id] ?? 'offline'}
                        />
                      }
                      folded={folded}
                      onSelect={() => void openDm(person.id)}
                    />
                  ))}
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
        </nav>
      </SidebarFrame>

      {/* Outside the list: on a phone the list is a Sheet, and a dialog drawn inside it
          would go with it the moment a new channel took you somewhere. */}
      <DialogPresence when={creating}>
        {() => <CreateChannelDialog onClose={() => setCreating(false)} />}
      </DialogPresence>
      <DialogPresence when={composing}>
        {() => <NewMessageDialog onClose={() => setComposing(false)} />}
      </DialogPresence>
    </>
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

/**
 * What sits beside a row's button, at its end: a count, a pulse. Outside the button, so the
 * row's name stays the button's whole name. Clear of the options button where the row has
 * one; on the rail, in the corner of the square.
 */
function RowMarks({ beside, children }: { beside: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-1.5',
        beside && 'right-8',
        'group-data-[collapsible=icon]:top-0.5 group-data-[collapsible=icon]:right-1 group-data-[collapsible=icon]:translate-y-0',
      )}
    >
      {children}
    </div>
  );
}

/** A count, keyed by its number by the caller: a new number is a new node, which pops. */
function RowBadge({ count, tone }: { count: number; tone: keyof typeof BADGE_TONE }) {
  return <SidebarMenuBadge className={cn(BADGE, BADGE_TONE[tone])}>{count}</SidebarMenuBadge>;
}

/** An agent mid-run: a pulse in its own colour, which reduced motion holds still. */
function LiveDot({ name }: { name: string }) {
  return (
    <span
      role="status"
      aria-label={`${name} is working`}
      title={`${name} is working`}
      className="size-[7px] flex-none rounded-full bg-(--iris) animate-[agent-live-pulse_1.6s_ease-in-out_infinite] motion-reduce:animate-none"
    />
  );
}

/**
 * Room at a button's end for what sits there. The generated button makes room for an
 * options button by itself; a count or a pulse beside it needs the same again.
 */
function endRoom(marks: boolean, action: boolean): string | undefined {
  if (action) return marks ? 'group-has-data-[sidebar=menu-action]/menu-item:pr-16' : undefined;
  return marks ? 'pr-10' : undefined;
}

/** One of the places in the workspace: Home, Activity, the pages, Browse. */
function PlaceRow({
  label,
  icon,
  active,
  folded,
  badge,
  muted = false,
  onSelect,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  folded: boolean;
  badge?: { count: number; tone: keyof typeof BADGE_TONE } | undefined;
  muted?: boolean;
  onSelect: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        aria-current={active ? 'page' : undefined}
        // Named by its own text where there is text. An `aria-label` that repeats the label
        // would make the name disagree with what everyone else sees; on the rail there is
        // no text, and the label is the name — and the tooltip, which beside the text
        // would only say it again.
        aria-label={folded ? label : undefined}
        title={folded ? label : undefined}
        className={cn(ROW, muted && 'text-muted-foreground', endRoom(Boolean(badge), false))}
        onClick={onSelect}
      >
        {icon}
        {!folded && <span>{label}</span>}
      </SidebarMenuButton>
      {badge && (
        <RowMarks beside={false}>
          <RowBadge key={badge.count} count={badge.count} tone={badge.tone} />
        </RowMarks>
      )}
    </SidebarMenuItem>
  );
}

/** A row that does something rather than going somewhere: New channel, and on the rail the
 *  two group actions that have nowhere else to be. */
function ActionRow({
  label,
  icon,
  folded,
  active = false,
  onSelect,
}: {
  label: string;
  icon: ReactNode;
  folded: boolean;
  active?: boolean;
  onSelect: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        aria-current={active ? 'page' : undefined}
        aria-label={folded ? label : undefined}
        title={folded ? label : undefined}
        className={cn(ROW, 'text-muted-foreground')}
        onClick={onSelect}
      >
        {icon}
        {!folded && <span>{label}</span>}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** Somebody you have no conversation with yet: choosing them opens one. */
function PersonRow({
  name,
  label = name,
  title,
  avatar,
  folded,
  live = false,
  onSelect,
}: {
  /** What the row shows: the name, and a status emoji where there is one. */
  name: string;
  /** What the row is called on the rail, where it shows nothing. */
  label?: string;
  /** The tooltip: the name, and a status where there is one. */
  title: string;
  avatar: ReactNode;
  folded: boolean;
  live?: boolean;
  onSelect: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        aria-label={folded ? label : undefined}
        // Beside the name, only a status is news; on the rail, all of it is.
        title={folded || title !== label ? title : undefined}
        className={cn(ROW, endRoom(live, false))}
        onClick={onSelect}
      >
        {avatar}
        {!folded && <span>{name}</span>}
      </SidebarMenuButton>
      {live && (
        <RowMarks beside={false}>
          <LiveDot name={label} />
        </RowMarks>
      )}
    </SidebarMenuItem>
  );
}

function ChannelRow({
  channel,
  folded,
  live = false,
  arriving = false,
  onArrived,
  onLeave,
}: {
  channel: ChannelWithState;
  folded: boolean;
  /** This row's agent is mid-run. Draws the pulse; means nothing on a person's row. */
  live?: boolean;
  /** New to the list since it was drawn: slide in, once. */
  arriving?: boolean;
  /** The entrance is over — or, on the fallback, never came. */
  onArrived?: (id: string) => void;
  /** The row is taking you to its conversation: the Sheet it may be in closes. */
  onLeave: () => void;
}) {
  const activeChannelId = useStore((s) => s.activeChannelId);
  const currentUserId = useStore((s) => s.currentUser?.id ?? null);
  const users = useStore((s) => s.users);
  const presence = useStore((s) => s.presence);
  // Whether this row has a draft, not the drafts: the map changes on every keystroke in the
  // composer, and each change would redraw every row and the menu module beside it.
  const hasDraft = useStore((s) => channelHasDraft(s.drafts, channel.id));
  const channelTitle = useStore((s) => s.channelTitle);
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
  // On the rail the lock is all there is to see, so the name says what it says — as the
  // row's hidden ", private" does beside the text.
  const railName = channel.kind === 'private' ? `${name}, private` : name;
  const muted = channel.membership?.notifyLevel === 'none';
  const marks = channel.mentionCount > 0 || live;
  const callLabel = liveKinds.includes('m') ? 'A meetup is on' : 'A huddle is on';

  // The floor under the entrance, as `usePresence` has one under an exit: a sidebar in a
  // background tab plays nothing, and the row must not stay "arriving" until it does.
  useEffect(() => {
    if (!arriving) return undefined;
    const timer = window.setTimeout(() => onArrived?.(channel.id), FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [arriving, onArrived, channel.id]);

  return (
    <SidebarMenuItem
      data-arriving={arriving ? 'true' : undefined}
      // From the side the rows already lean towards on hover. Only while the list says it
      // is arriving (`useArrivals`), so the list at start-up and after the console is still.
      className="data-[arriving=true]:animate-[row-arrive_var(--dur-open)_var(--blob-ease-out)]"
      onAnimationEnd={(event) => {
        if (arriving && event.target === event.currentTarget) onArrived?.(channel.id);
      }}
    >
      <SidebarMenuButton
        isActive={active}
        aria-current={active ? 'page' : undefined}
        data-unread={channel.hasUnread && !active ? 'true' : undefined}
        data-muted={muted ? 'true' : undefined}
        aria-label={folded ? railName : undefined}
        title={folded ? railName : undefined}
        className={cn(ROW, endRoom(marks, !folded))}
        onClick={() => {
          onLeave();
          void showChannel(channel.id);
        }}
      >
        {otherId ? (
          <AvatarWithPresence user={users[otherId]} state={presence[otherId] ?? 'offline'} />
        ) : (
          // A private channel wears its lock here as Slack's sidebar does, and as ⌘K
          // already did: the same `#` for both made the one difference that decides who
          // can read a channel invisible in the list people look at most.
          <span
            aria-hidden="true"
            data-mark={isDm ? 'dm' : channel.kind === 'private' ? 'private' : 'public'}
            className="inline-grid w-4 flex-none place-items-center font-medium text-muted-foreground group-data-active/menu-button:text-(--blob-accent)"
          >
            {isDm ? '•' : channel.kind === 'private' ? <LockIcon size="sm" /> : '#'}
          </span>
        )}
        {!folded && (
          <span className={cn('min-w-0 flex-1 truncate', muted && 'opacity-55')}>
            {name}
            {channel.kind === 'private' && <span className="sr-only">, private</span>}
          </span>
        )}
        {/* An unsent draft, marked the way Slack marks one: a quiet word rather than a
            count, because there is only ever one draft per channel and a "1" would invite
            reading it as an unread. Not the accent: it is your own unfinished business. */}
        {!folded && !active && hasDraft && (
          <span
            className="flex-none text-(length:--text-2xs) leading-[18px] text-muted-foreground italic"
            title="You have an unsent draft here"
          >
            draft
          </span>
        )}
        {liveKinds && (
          <span
            role="img"
            aria-label={callLabel}
            title={callLabel}
            className="inline-grid flex-none text-(--blob-accent) animate-[chip-in_var(--dur-fast)_var(--blob-ease-out)_both] group-data-[collapsible=icon]:hidden"
          >
            {liveKinds.includes('m') ? <VideoIcon size="sm" /> : <HuddleIcon size="sm" />}
          </span>
        )}
      </SidebarMenuButton>
      {marks && (
        <RowMarks beside={!folded}>
          {channel.mentionCount > 0 && (
            <RowBadge key={channel.mentionCount} count={channel.mentionCount} tone="mention" />
          )}
          {live && <LiveDot name={name} />}
        </RowMarks>
      )}
      {/* Beside the name; on the rail, in the corner of the square, shown on hover and on
          keyboard focus as it is beside a name. The menu owns this button (`lazyDropdown`). */}
      <ChannelMenu
        channel={channel}
        onOpenDetails={() => {
          onLeave();
          void showChannel(channel.id);
        }}
        trigger={
          <SidebarMenuAction
            showOnHover
            aria-label={`Options for ${name}`}
            className="size-7 w-7 -translate-y-1/2 rounded-sm text-muted-foreground peer-data-[size=default]/menu-button:top-1/2 hover:bg-(--ground-press) hover:text-sidebar-foreground group-data-[collapsible=icon]:top-6! group-data-[collapsible=icon]:right-0.5 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:size-5 group-data-[collapsible=icon]:translate-y-0 group-data-[collapsible=icon]:bg-sidebar"
            onClick={(event) => event.stopPropagation()}
          >
            <MoreIcon size="sm" />
          </SidebarMenuAction>
        }
      />
    </SidebarMenuItem>
  );
}

/** One of your own sections (M3 · B3): its name folds it, its menu renames or deletes it.
 *  Folded, it still shows what needs you — an unread conversation and the one you are
 *  in — the way Slack keeps a collapsed section's unread rows. */
function SectionGroup({
  section,
  sections,
  folded,
  live,
  arriving,
  onArrived,
  onLeave,
}: {
  section: SidebarSection;
  sections: SidebarSection[];
  /** The sidebar is a rail of icons: rows only, no heading. */
  folded: boolean;
  live: (channel: ChannelWithState) => boolean;
  arriving: (id: string) => boolean;
  onArrived: (id: string) => void;
  onLeave: () => void;
}) {
  const channels = useStore((s) => s.channels);
  const activeChannelId = useStore((s) => s.activeChannelId);
  const channelTitle = useStore((s) => s.channelTitle);
  const setSidebarSections = useStore((s) => s.setSidebarSections);

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
    <SidebarGroup role="region" aria-label={section.name} className="px-1">
      {!folded && (
        // Its own positioned box, which the Options button is placed in.
        <div className="group/section relative">
          <SidebarGroupLabel
            render={<button type="button" />}
            aria-expanded={!section.collapsed}
            onClick={() => void setSidebarSections(toggleCollapsed(sections, section.id))}
            className="w-full gap-1.5 pr-8 text-muted-foreground hover:bg-(--ground-hover) hover:text-sidebar-foreground"
          >
            <ChevronDownIcon
              size="sm"
              className={cn(
                'transition-transform duration-(--dur-fast)',
                section.collapsed && '-rotate-90',
              )}
            />
            <span className="truncate">{section.name}</span>
          </SidebarGroupLabel>
          <SectionMenu
            section={section}
            sections={sections}
            trigger={
              <SidebarGroupAction
                aria-label={`Options for ${section.name}`}
                className="top-1.5 right-1 size-5 text-muted-foreground group-focus-within/section:opacity-100 group-hover/section:opacity-100 hover:bg-(--ground-press) hover:text-sidebar-foreground aria-expanded:opacity-100 md:opacity-0"
              >
                <MoreIcon size="sm" />
              </SidebarGroupAction>
            }
          />
        </div>
      )}
      <SidebarMenu>
        {shown.map((channel) => (
          <ChannelRow
            key={channel.id}
            channel={channel}
            folded={folded}
            live={live(channel)}
            arriving={arriving(channel.id)}
            onArrived={onArrived}
            onLeave={onLeave}
          />
        ))}
      </SidebarMenu>
      {!folded && !section.collapsed && conversations.length === 0 && (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Move a conversation here from its ··· menu.
        </p>
      )}
    </SidebarGroup>
  );
}
