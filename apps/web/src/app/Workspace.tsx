/** The signed-in shell: top bar, sidebar, main view, optional thread panel. */

import { Suspense, lazy, useEffect, useState } from 'react';
import type { ChannelWithState } from '@blob/shared';
import { useStore } from '../lib/store.ts';
import { socket } from '../lib/socket.ts';
import {
  DEFAULT_MEMBER_SECTION,
  isPersonalSection,
  navigate,
  parseRoute,
  pathForChannel,
  pathForRoute,
  usePath,
} from '../lib/router.ts';
import { Sidebar } from '../features/channels/Sidebar.tsx';
import { ChannelView } from '../features/messages/ChannelView.tsx';
import { ThreadsView } from '../features/messages/ThreadsView.tsx';
import { TasksView } from '../features/agentic/TasksView.tsx';
import { SavedView } from '../features/messages/SavedView.tsx';
import { WhatsNewView } from '../features/settings/WhatsNewView.tsx';
import { ThreadPanel } from '../features/messages/ThreadPanel.tsx';
import { AgentTerminalPanel } from '../features/agentic/AgentTerminalPanel.tsx';
import { CommandPalette } from '../features/palette/CommandPalette.tsx';
import { SearchView } from '../features/search/SearchView.tsx';
// Lazy: the consoles are ~3,000 lines of JSX an ordinary member never renders,
// and they were arriving in everyone's first paint.
const AdminConsole = lazy(() =>
  import('../features/admin/AdminConsole.tsx').then((m) => ({ default: m.AdminConsole })),
);
const WorkspaceConsole = lazy(() =>
  import('../features/workspace/WorkspaceConsole.tsx').then((m) => ({
    default: m.WorkspaceConsole,
  })),
);
import { ProfileView } from '../features/settings/ProfileView.tsx';
import { TopBar } from '../features/shell/TopBar.tsx';
import { CatchUpPanel } from '../features/messages/CatchUpPanel.tsx';
import { FeedbackDialog } from '../features/feedback/FeedbackDialog.tsx';
import { ShortcutHelp } from '../components/ShortcutHelp.tsx';
import { isTypingTarget, matchShortcut } from '../lib/shortcuts.ts';
import { closeThread, showChannel, showMessage } from '../lib/navigation.ts';
import { updateBadge } from '../lib/badge.ts';

export function Workspace({ onSignedOut }: { onSignedOut: () => void }) {
  const channels = useStore((s) => s.channels);
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const activeChannelId = useStore((s) => s.activeChannelId);
  const activeThreadRootId = useStore((s) => s.activeThreadRootId);
  const catchupScope = useStore((s) => s.catchupScope);
  const terminalTarget = useStore((s) => s.terminalTarget);
  const openChannel = useStore((s) => s.openChannel);
  const openThread = useStore((s) => s.openThread);

  const path = usePath();
  const route = parseRoute(path);
  const view = route.view;
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'owner';

  const [paletteOpen, setPaletteOpen] = useState(false);
  // The channel drawer on narrow viewports. Closed on every conversation change so
  // picking a channel dismisses it, the way every mobile drawer behaves.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Held with the id it belongs to, so following a second link shows no error without
  // an effect having to clear one — a synchronous reset in the effect below would be a
  // cascading render for a value that can simply be derived.
  const [permalinkError, setPermalinkError] = useState<{ id: string; message: string } | null>(
    null,
  );

  // Two jobs, one effect: send a member who typed /admin back to the conversation, and
  // rewrite a stale or misspelt URL to the route it actually resolved to, so the address
  // bar never disagrees with the screen.
  useEffect(() => {
    const resolved = parseRoute(path);
    // /workspace is no longer admin-only: it holds everyone's preferences as well as the
    // workspace's settings. A member is sent to their own section rather than off the
    // page — bouncing them to the conversation would mean the gear icon did nothing.
    if (resolved.view === 'workspace' && !isAdmin && !isPersonalSection(resolved.section)) {
      navigate(pathForRoute({ view: 'workspace', section: DEFAULT_MEMBER_SECTION }), {
        replace: true,
      });
      return;
    }
    if (resolved.view === 'admin' && !isAdmin) {
      navigate('/', { replace: true });
      return;
    }
    const canonical = pathForRoute(resolved);
    if (canonical !== path) navigate(canonical, { replace: true });
  }, [path, isAdmin]);

  /**
   * Follow a permalink, then let it replace itself with the conversation.
   *
   * Keyed on the id rather than the whole route, so re-rendering while the fetch is in
   * flight does not start a second one. `showMessage` navigates to / on success, which
   * is what takes this effect out of scope.
   */
  const permalinkId = route.view === 'permalink' ? route.messageId : null;
  useEffect(() => {
    if (!permalinkId) return undefined;
    let cancelled = false;
    void showMessage(permalinkId).catch(() => {
      // 404 covers deleted and no-access alike, deliberately — so this cannot say which
      // it was, and stays on this screen rather than dumping somebody in a channel with
      // no explanation of why the link did nothing.
      if (!cancelled) {
        setPermalinkError({
          id: permalinkId,
          message: 'That message is gone, or it is somewhere you cannot see.',
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [permalinkId]);
  const permalinkFailure = permalinkError?.id === permalinkId ? permalinkError.message : null;

  // The URL names a conversation; make the store agree. Interactions go the other way
  // (navigation.ts navigates after opening), so this only acts on a *difference* —
  // a deep link, a reload, or the Back button — and never double-fetches.
  const routeChannelId = route.view === 'channel' ? route.channelId : null;
  const routeThreadRootId = route.view === 'channel' ? (route.threadRootId ?? null) : null;
  useEffect(() => {
    if (!routeChannelId) return;
    const store = useStore.getState();
    if (store.activeChannelId !== routeChannelId) void store.openChannel(routeChannelId);
    if (store.activeThreadRootId !== routeThreadRootId) void store.openThread(routeThreadRootId);
  }, [routeChannelId, routeThreadRootId]);

  // Open something on arrival so the app never starts on an empty pane. Not while a
  // permalink is resolving: that would race it and land on #general instead. The URL
  // is rewritten to the channel's real address, so a reload comes back here.
  useEffect(() => {
    if (activeChannelId || route.view !== 'messages') return;
    const first =
      Object.values(channels).find((c) => c.name === 'general' && c.membership) ??
      Object.values(channels).find((c) => c.membership);
    if (first) {
      void openChannel(first.id);
      navigate(pathForChannel(first.id), { replace: true });
    }
  }, [channels, activeChannelId, openChannel, route.view]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [activeChannelId, view]);

  // The tab title carries the unread state a backgrounded tab cannot show any
  // other way; the OS badge rides along where the app is installed.
  useEffect(() => {
    const rows = Object.values(channels);
    const mentions = rows.reduce((sum, c) => sum + (c.mentionCount ?? 0), 0);
    const hasUnread = rows.some((c) => c.hasUnread);
    updateBadge(mentions, hasUnread);
  }, [channels]);

  // Presence is push-on-subscribe: tell the server whose dots we're showing.
  useEffect(() => {
    const userIds = Object.keys(users);
    if (userIds.length > 0) socket.sendControl({ t: 'presence.sub', userIds });
  }, [users]);

  // Every binding comes from `lib/shortcuts`, which is also what ⌘/ renders — so the
  // help can neither invent a shortcut nor miss one. What stays here is only what each
  // one *does*, which is the part that needs this component's state.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const typing = isTypingTarget(event.target);
      const shortcut = matchShortcut(event, { typing });
      if (!shortcut) return;

      switch (shortcut.id) {
        case 'palette':
          event.preventDefault();
          setPaletteOpen(true);
          return;
        case 'search':
          event.preventDefault();
          navigate('/search');
          return;
        case 'threads':
          event.preventDefault();
          navigate('/threads');
          return;
        case 'help':
          event.preventDefault();
          setHelpOpen((open) => !open);
          return;
        case 'next-unread': {
          event.preventDefault();
          const next = nextUnreadChannelId(channels, activeChannelId);
          if (next) void showChannel(next);
          return;
        }
        case 'edit-last':
          // Handled by the composer, which is the only thing that knows whether the box
          // is empty. Listed here so `⌘/` documents it and this switch stays the whole
          // vocabulary.
          return;
        case 'close':
          // Innermost first: closing a thread while a dialog is open over it would leave
          // the dialog floating above a view that changed underneath.
          if (helpOpen) setHelpOpen(false);
          else if (feedbackOpen) setFeedbackOpen(false);
          else if (paletteOpen) setPaletteOpen(false);
          else if (activeThreadRootId) closeThread();
          else if (activeChannelId) {
            // Nothing left to close: Slack's Esc — the channel is read. Deliberately
            // clears a mark-unread first, or the ratchet's suppression would swallow
            // the most explicit read gesture there is.
            useStore.setState((s) =>
              s.suppressReadFor === activeChannelId ? { suppressReadFor: null } : s,
            );
            void useStore.getState().markRead(activeChannelId).catch(() => undefined);
            useStore.setState((s) => ({
              unreadMarkers: { ...s.unreadMarkers, [activeChannelId]: null },
            }));
          }
          return;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    paletteOpen,
    helpOpen,
    feedbackOpen,
    activeThreadRootId,
    openThread,
    channels,
    activeChannelId,
    openChannel,
  ]);

  // The right-hand column belongs to the conversation view only, and holds one thing at
  // a time: a thread, or a terminal in the agent this DM is with.
  const inConversation = view === 'messages' || view === 'channel';
  const panelOpen = inConversation && Boolean(activeThreadRootId || terminalTarget);

  // Administration takes the whole window. The rail and channel list are navigation for
  // a conversation, and none of it helps someone reading an audit log. What does stay is
  // everything that belongs to the person rather than the view: the top bar with the
  // account menu, ⌘K, and the feedback dialog — which matters most here, because the
  // report attaches a snapshot of the screen you are on, and leaving the console to file
  // one would attach a channel instead of the page that went wrong.
  if (route.view === 'workspace') {
    return (
      <>
        <Suspense fallback={<div className="auth"><p className="muted">Loading…</p></div>}>
          <WorkspaceConsole
            section={route.section}
            detailId={route.detailId}
            onFeedback={() => setFeedbackOpen(true)}
            onSignedOut={onSignedOut}
          />
        </Suspense>
        {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
        {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
        {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      </>
    );
  }

  if (route.view === 'admin' && isAdmin) {
    return (
      <>
        <Suspense fallback={<div className="auth"><p className="muted">Loading…</p></div>}>
          <AdminConsole
            section={route.section}
            detailId={route.detailId}
            onFeedback={() => setFeedbackOpen(true)}
          />
        </Suspense>
        {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
        {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
        {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      </>
    );
  }

  return (
    <div
      className="shell"
      data-panel={panelOpen ? 'open' : 'closed'}
      data-sidebar={sidebarOpen ? 'open' : 'closed'}
    >
      <TopBar
        onFeedback={() => setFeedbackOpen(true)}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        view={view}
      />
      <Sidebar onOpenSearch={() => navigate('/search')} />
      {sidebarOpen && (
        <button
          type="button"
          className="drawer-scrim"
          aria-label="Close channel list"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {view === 'permalink' && (
        <div className="pane">
          <div className="empty-state">
            <div className="empty-state-title">
              {permalinkFailure ? 'That link did not open' : 'Finding that message…'}
            </div>
            {permalinkFailure && <div className="empty-state-body">{permalinkFailure}</div>}
            {permalinkFailure && (
              <button className="btn" onClick={() => navigate('/')} style={{ marginTop: 12 }}>
                Back to the conversation
              </button>
            )}
          </div>
        </div>
      )}
      {(view === 'messages' || view === 'channel') && <ChannelView />}
      {view === 'threads' && <ThreadsView />}
      {view === 'tasks' && <TasksView />}
      {view === 'saved' && <SavedView />}
      {view === 'changelog' && <WhatsNewView />}
      {view === 'search' && <SearchView />}
      {view === 'profile' && <ProfileView />}

      {panelOpen &&
        (terminalTarget ? (
          <AgentTerminalPanel
            pluginId={terminalTarget.pluginId}
            agentName={terminalTarget.agentName}
          />
        ) : (
          <ThreadPanel rootId={activeThreadRootId as string} />
        ))}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      {catchupScope && (
        <CatchUpPanel
          channelId={catchupScope === 'channel' ? activeChannelId : null}
          onClose={() => useStore.setState({ catchupScope: null })}
        />
      )}
    </div>
  );
}

/**
 * The next channel with something unread, wrapping past the end.
 *
 * Ordered the way the sidebar orders it — starred first, then by name — so the key walks
 * the list you can see rather than a different one that happens to be in memory. Wrapping
 * from the current position rather than always starting at the top is what makes it
 * repeatable: pressing it twice should reach the second unread, not the first again.
 */
function nextUnreadChannelId(
  channels: Record<string, ChannelWithState>,
  activeChannelId: string | null,
): string | null {
  const ordered = Object.values(channels)
    .filter((c) => c.membership !== null && !c.archivedAt)
    .sort((a, b) => {
      const starred = Number(b.membership?.isStarred) - Number(a.membership?.isStarred);
      return starred !== 0 ? starred : (a.name ?? '').localeCompare(b.name ?? '');
    });

  const from = ordered.findIndex((c) => c.id === activeChannelId);
  for (let step = 1; step <= ordered.length; step += 1) {
    const candidate = ordered[(from + step + ordered.length) % ordered.length];
    if (candidate && candidate.hasUnread && candidate.id !== activeChannelId) return candidate.id;
  }
  return null;
}
