/** The signed-in shell: rail, sidebar, main view, optional thread panel. */

import { useEffect, useState } from 'react';
import { useStore } from '../lib/store.ts';
import { socket } from '../lib/socket.ts';
import { Rail, type RailView } from '../features/channels/Rail.tsx';
import { Sidebar } from '../features/channels/Sidebar.tsx';
import { ChannelView } from '../features/messages/ChannelView.tsx';
import { ThreadPanel } from '../features/messages/ThreadPanel.tsx';
import { CommandPalette } from '../features/palette/CommandPalette.tsx';
import { SearchView } from '../features/search/SearchView.tsx';
import { SettingsView } from '../features/settings/SettingsView.tsx';

export function Workspace({ onSignedOut }: { onSignedOut: () => void }) {
  const channels = useStore((s) => s.channels);
  const users = useStore((s) => s.users);
  const activeChannelId = useStore((s) => s.activeChannelId);
  const activeThreadRootId = useStore((s) => s.activeThreadRootId);
  const openChannel = useStore((s) => s.openChannel);
  const openThread = useStore((s) => s.openThread);

  const [view, setView] = useState<RailView>('messages');
  const [paletteOpen, setPaletteOpen] = useState(false);

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
        setView('search');
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

  return (
    <div className="shell" data-panel={panelOpen ? 'open' : 'closed'}>
      <Rail view={view} onChange={setView} />
      <Sidebar onOpenSearch={() => setView('search')} />

      {view === 'messages' && <ChannelView />}
      {view === 'search' && <SearchView />}
      {view === 'settings' && <SettingsView onSignedOut={onSignedOut} />}

      {panelOpen && <ThreadPanel rootId={activeThreadRootId as string} />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
