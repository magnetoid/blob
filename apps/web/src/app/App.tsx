/** Root: decides between the auth screen and the workspace, and owns theme wiring. */

import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.ts';
import { connectStoreToSocket, useStore } from '../lib/store.ts';
import { AuthScreen } from '../features/auth/AuthScreen.tsx';
import { Workspace } from './Workspace.tsx';

type Phase = 'loading' | 'signed-out' | 'signed-in';

export function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [needsSetup, setNeedsSetup] = useState(false);
  const boot = useStore((s) => s.boot);
  const prefs = useStore((s) => s.currentUser?.prefs);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const data = await api.bootstrap();
        if (cancelled) return;
        boot(data);
        setPhase('signed-in');
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          const state = await api.auth.state().catch(() => ({ needsSetup: false }));
          if (cancelled) return;
          setNeedsSetup(state.needsSetup);
          setPhase('signed-out');
        } else {
          setPhase('signed-out');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [boot]);

  // Connect the socket only while signed in.
  useEffect(() => {
    if (phase !== 'signed-in') return undefined;
    return connectStoreToSocket();
  }, [phase]);

  // Theme and density are stamped on <html> so tokens.css can respond.
  useEffect(() => {
    const root = document.documentElement;
    if (!prefs || prefs.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', prefs.theme);
    root.setAttribute('data-density', prefs?.density ?? 'comfortable');
  }, [prefs]);

  if (phase === 'loading') {
    return (
      <div className="auth">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (phase === 'signed-out') {
    return (
      <AuthScreen
        needsSetup={needsSetup}
        onSignedIn={async () => {
          boot(await api.bootstrap());
          setPhase('signed-in');
        }}
      />
    );
  }

  return <Workspace onSignedOut={() => setPhase('signed-out')} />;
}
