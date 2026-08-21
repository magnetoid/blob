/** The signed-in shell: top bar, rail, sidebar, main view, optional thread panel. */

import { useEffect, useState } from 'react';
import { useStore } from '../lib/store.ts';
import { socket } from '../lib/socket.ts';
import { navigate, parseRoute, pathForRoute, pathForView, usePath } from '../lib/router.ts';
import { Rail } from '../features/channels/Rail.tsx';
import { Sidebar } from '../features/channels/Sidebar.tsx';
import { ChannelView } from '../features/messages/ChannelView.tsx';
import { ThreadPanel } from '../features/messages/ThreadPanel.tsx';
import { CommandPalette } from '../features/palette/CommandPalette.tsx';
import { SearchView } from '../features/search/SearchView.tsx';
import { AdminConsole } from '../features/admin/AdminConsole.tsx';
import { SettingsView } from '../features/settings/SettingsView.tsx';
import { ProfileView } from '../features/settings/ProfileView.tsx';
import { TopBar } from '../features/shell/TopBar.tsx';
import { FeedbackDialog } from '../features/feedback/FeedbackDialog.tsx';

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

  // Two jobs, one effect: send a member who typed /admin back to the conversation, and
  // rewrite a stale or misspelt URL to the route it actually resolved to, so the address
  // bar never disagrees with the screen.
  useEffect(() => {
    const resolved = parseRoute(path);
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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (meta && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        navigate('/search');
        return;
      }
      if (event.key === 'Escape') {
        if (paletteOpen) setPaletteOpen(false);
        else if (activeThreadRootId) void openThread(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paletteOpen, activeThreadRootId, openThread]);

  // The thread panel belongs to the conversation view only.
  const panelOpen = view === 'messages' && Boolean(activeThreadRootId);

  // Administration takes the whole window. The rail and channel list are navigation for
  // a conversation, and none of it helps someone reading an audit log. What does stay is
  // everything that belongs to the person rather than the view: the top bar with the
  // account menu, ⌘K, and the feedback dialog — which matters most here, because the
  // report attaches a snapshot of the screen you are on, and leaving the console to file
  // one would attach a channel instead of the page that went wrong.
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
      </>
    );
  }

  return (
    <div className="shell" data-panel={panelOpen ? 'open' : 'closed'}>
      <TopBar onFeedback={() => setFeedbackOpen(true)} />
      <Rail view={view} onChange={(next) => navigate(pathForView(next))} />
      <Sidebar onOpenSearch={() => navigate('/search')} />

      {view === 'messages' && <ChannelView />}
      {view === 'search' && <SearchView />}
      {view === 'settings' && <SettingsView onSignedOut={onSignedOut} />}
      {view === 'profile' && <ProfileView />}

      {panelOpen && <ThreadPanel rootId={activeThreadRootId as string} />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
    </div>
  );
}
