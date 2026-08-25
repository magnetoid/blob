/** The signed-in shell: top bar, rail, sidebar, main view, optional thread panel. */

import { useEffect, useState } from 'react';
import type { ChannelWithState } from '@blob/shared';
import { useStore } from '../lib/store.ts';
import { socket } from '../lib/socket.ts';
import {
  DEFAULT_MEMBER_SECTION,
  isPersonalSection,
  navigate,
  parseRoute,
  pathForRoute,
  pathForView,
  usePath,
} from '../lib/router.ts';
import { Rail } from '../features/channels/Rail.tsx';
import { Sidebar } from '../features/channels/Sidebar.tsx';
import { ChannelView } from '../features/messages/ChannelView.tsx';
import { ThreadsView } from '../features/messages/ThreadsView.tsx';
import { SavedView } from '../features/messages/SavedView.tsx';
import { ThreadPanel } from '../features/messages/ThreadPanel.tsx';
import { CommandPalette } from '../features/palette/CommandPalette.tsx';
import { SearchView } from '../features/search/SearchView.tsx';
import { AdminConsole } from '../features/admin/AdminConsole.tsx';
import { WorkspaceConsole } from '../features/workspace/WorkspaceConsole.tsx';
import { ProfileView } from '../features/settings/ProfileView.tsx';
import { TopBar } from '../features/shell/TopBar.tsx';
import { FeedbackDialog } from '../features/feedback/FeedbackDialog.tsx';
import { ShortcutHelp } from '../components/ShortcutHelp.tsx';
import { isTypingTarget, matchShortcut } from '../lib/shortcuts.ts';

export function Workspace({ onSignedOut }: { onSignedOut: () => void }) {
  const channels = useStore((s) => s.channels);
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const activeChannelId = useStore((s) => s.activeChannelId);
  const activeThreadRootId = useStore((s) => s.activeThreadRootId);
  const openChannel = useStore((s) => s.openChannel);
  const openThread = useStore((s) => s.openThread);

  const path = usePath();
  const route = parseRoute(path);
  const view = route.view;
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'owner';

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

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

  // Open something on arrival so the app never starts on an empty pane.
  useEffect(() => {
    if (activeChannelId) return;
    const first =
      Object.values(channels).find((c) => c.name === 'general' && c.membership) ??
      Object.values(channels).find((c) => c.membership);
    if (first) void openChannel(first.id);
  }, [channels, activeChannelId, openChannel]);

  // Presence is push-on-subscribe: tell the server whose dots we're showing.
  useEffect(() => {
    const userIds = Object.keys(users);
    if (userIds.length > 0) socket.send({ t: 'presence.sub', userIds });
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
          if (next) void openChannel(next);
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
          else if (activeThreadRootId) void openThread(null);
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

  // The thread panel belongs to the conversation view only.
  const panelOpen = view === 'messages' && Boolean(activeThreadRootId);

  // Administration takes the whole window. The rail and channel list are navigation for
  // a conversation, and none of it helps someone reading an audit log. What does stay is
  // everything that belongs to the person rather than the view: the top bar with the
  // account menu, ⌘K, and the feedback dialog — which matters most here, because the
  // report attaches a snapshot of the screen you are on, and leaving the console to file
  // one would attach a channel instead of the page that went wrong.
  if (route.view === 'workspace') {
    return (
      <>
        <WorkspaceConsole
          section={route.section}
          detailId={route.detailId}
          onFeedback={() => setFeedbackOpen(true)}
          onSignedOut={onSignedOut}
        />
        {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
        {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
        {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      </>
    );
  }

  if (route.view === 'admin' && isAdmin) {
    return (
      <>
        <AdminConsole
          section={route.section}
          detailId={route.detailId}
          onFeedback={() => setFeedbackOpen(true)}
        />
        {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
        {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
        {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      </>
    );
  }

  return (
    <div className="shell" data-panel={panelOpen ? 'open' : 'closed'}>
      <TopBar onFeedback={() => setFeedbackOpen(true)} />
      <Rail view={view} onChange={(next) => navigate(pathForView(next))} />
      <Sidebar onOpenSearch={() => navigate('/search')} />

      {view === 'messages' && <ChannelView />}
      {view === 'threads' && <ThreadsView />}
      {view === 'saved' && <SavedView />}
      {view === 'search' && <SearchView />}
      {view === 'profile' && <ProfileView />}

      {panelOpen && <ThreadPanel rootId={activeThreadRootId as string} />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
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
