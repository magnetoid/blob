/** Root: decides between the auth screen and the workspace, and owns theme wiring. */

import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.ts';
import { connectStoreToSocket, useStore } from '../lib/store.ts';
import { applyTheme, pickTheme } from '../lib/theme.ts';
import { AuthScreen } from '../features/auth/AuthScreen.tsx';
import { Workspace } from './Workspace.tsx';

type Phase = 'loading' | 'signed-out' | 'signed-in';

export function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [needsSetup, setNeedsSetup] = useState(false);
  const boot = useStore((s) => s.boot);
  const hydrateOutbox = useStore((s) => s.hydrateOutbox);
  const prefs = useStore((s) => s.currentUser?.prefs);
  const themes = useStore((s) => s.themes);

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
    hydrateOutbox();
    return connectStoreToSocket();
  }, [phase, hydrateOutbox]);

  // Theme and density are stamped on <html> so tokens.css can respond. This is the
  // single place the document is touched; the theme editor previews through the same
  // helpers.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-density', prefs?.density ?? 'comfortable');
    if (!prefs) return undefined;

    const apply = () => applyTheme(pickTheme(themes, prefs), prefs.theme);
    apply();

    // 'system' has to follow the OS while the app is open, not only at load.
    if (prefs.theme !== 'system') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [prefs, themes]);

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
