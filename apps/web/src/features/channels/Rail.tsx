/** The 64px navigation rail: view switching plus your own avatar. */

import { useStore } from '../../lib/store.ts';
import { Avatar } from '../../components/Avatar.tsx';
import { MessagesIcon, SearchIcon, SettingsIcon } from '../../components/Icon.tsx';

export type RailView = 'messages' | 'search' | 'settings';

interface Props {
  view: RailView;
  onChange: (view: RailView) => void;
}

export function Rail({ view, onChange }: Props) {
  const currentUser = useStore((s) => s.currentUser);
  const workspaceName = useStore((s) => s.workspaceName);
  const status = useStore((s) => s.status);

  return (
    <nav className="rail" aria-label="Views">
      <div className="rail-mark" aria-hidden="true">
        {workspaceName.trim().charAt(0).toUpperCase() || 'B'}
      </div>

      <button
        className="rail-btn"
        aria-pressed={view === 'messages'}
        onClick={() => onChange('messages')}
        title="Messages"
      >
        <MessagesIcon size={19} strokeWidth={1.6} />
      </button>
      <button
        className="rail-btn"
        aria-pressed={view === 'search'}
        onClick={() => onChange('search')}
        title="Search"
      >
        <SearchIcon size={19} strokeWidth={1.6} />
      </button>
      <button
        className="rail-btn"
        aria-pressed={view === 'settings'}
        onClick={() => onChange('settings')}
        title="Preferences"
      >
        <SettingsIcon size={19} strokeWidth={1.6} />
      </button>

      <div className="rail-spacer" />

      <span className="rail-avatar">
        <Avatar user={currentUser ?? undefined} />
        <span
          className="presence-dot"
          data-state={status === 'online' ? 'active' : 'offline'}
          title={status === 'online' ? 'Connected' : 'Reconnecting…'}
        />
      </span>
    </nav>
  );
}
