/** The 64px navigation rail: view switching plus your own avatar. */

import { useStore } from '../../lib/store.ts';
import { navigate, pathForRoute, type View } from '../../lib/router.ts';
import { MembersIcon, MessagesIcon, SearchIcon, SettingsIcon } from '../../components/Icon.tsx';

/** Views the rail can switch to. Profile has no rail button; it lives in the user menu. */
export type RailView = Exclude<View, 'profile' | 'permalink'>;

interface Props {
  /** The whole app's view, so a screen the rail cannot reach simply presses nothing. */
  view: View;
  onChange: (view: RailView) => void;
}

export function Rail({ view, onChange }: Props) {
  const currentUser = useStore((s) => s.currentUser);
  const workspaceName = useStore((s) => s.workspaceName);
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'owner';

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
      {isAdmin && (
        <button
          className="rail-btn"
          aria-pressed={view === 'admin'}
          onClick={() => onChange('admin')}
          title="Administration"
        >
          <MembersIcon size={19} strokeWidth={1.6} />
        </button>
      )}

      <button
        className="rail-btn"
        aria-pressed={view === 'workspace'}
        onClick={() => navigate(pathForRoute({ view: 'workspace', section: 'preferences' }))}
        title="Preferences"
      >
        <SettingsIcon size={19} strokeWidth={1.6} />
      </button>

      {/* The avatar used to sit here. It is in the top-right user menu now, which is
          where someone coming from Slack looks for it. */}
      <div className="rail-spacer" />
    </nav>
  );
}
