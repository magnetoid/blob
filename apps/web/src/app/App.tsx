/** Root: decides between the auth screen and the workspace, and owns theme wiring. */

import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.ts';
import { connectStoreToSocket, useStore } from '../lib/store.ts';
import { flushDrafts } from '../lib/drafts.ts';
import { applyTheme, pickTheme } from '../lib/theme.ts';
import { AuthScreen } from '../features/auth/AuthScreen.tsx';
import { resetTokenFromUrl } from '../features/auth/tokens.ts';
import { Workspace } from './Workspace.tsx';

type Phase = 'loading' | 'signed-out' | 'signed-in';

export function App() {
  // Read once, before anything can navigate: a reset link has to win over a live
  // session. Resetting deletes every session this address holds, so the person
  // following the link from their inbox may well still have a valid cookie in this
  // tab — and booting them into the workspace would swallow the only token they have.
  const [resetToken, setResetToken] = useState(resetTokenFromUrl);
  const [phase, setPhase] = useState<Phase>('loading');
  const [needsSetup, setNeedsSetup] = useState(false);
  const boot = useStore((s) => s.boot);
  const hydrateOutbox = useStore((s) => s.hydrateOutbox);
  const hydrateDrafts = useStore((s) => s.hydrateDrafts);
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
    hydrateDrafts();
    return connectStoreToSocket();
  }, [phase, hydrateOutbox, hydrateDrafts]);

  // Write anything the composer scheduled before the tab goes away. `pagehide` rather
  // than `beforeunload`: it is the one that fires on iOS and when a page goes into the
  // back/forward cache, which is most of the ways a phone leaves a page.
  useEffect(() => {
    const flush = () => flushDrafts();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

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

  if (phase === 'signed-out' || resetToken) {
    return (
      <AuthScreen
        needsSetup={needsSetup}
        onSignedIn={async () => {
          boot(await api.bootstrap());
          // Spent, and it has to stop forcing this screen or a completed reset would
          // sign you in and then show you the form it just satisfied.
          setResetToken(null);
          setPhase('signed-in');
        }}
      />
    );
  }

  return <Workspace onSignedOut={() => setPhase('signed-out')} />;
}
