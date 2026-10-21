/** The way out.
 *
 * The last part of the You page, because it is the one control here that ends the
 * session rather than changing a setting — and because "sign out" sitting in the middle
 * of a page of preferences is a button nobody wants to find by accident. Where else you
 * are signed in, and signing those out, is Sign-in & security's (M3 · B1).
 */

import { useStore } from '../../lib/store.ts';
import { api } from '../../lib/api.ts';
import { navigate } from '../../lib/router.ts';
import { leaveCall } from '../../lib/calls.ts';
import { Card } from '../console/Card.tsx';
import type { ConsoleSectionProps } from '../console/ConsoleShell.tsx';

export function AccountCard({ onSignedOut }: ConsoleSectionProps) {
  const reset = useStore((s) => s.reset);

  // The way out is the card's footer: the one control on these pages that ends the
  // session, apart from the settings above it rather than in their run.
  return (
    <Card
      title="Account"
      description="Sign out of Blob on this device."
      footer={
        <button
          className="btn"
          onClick={async () => {
            // Hangs up before anything else: `reset()` only forgets the call session,
            // it does not disconnect the room, and this switches away from the app
            // with no reload — a lingering room would keep the microphone live with no
            // screen left to leave it from.
            await leaveCall();
            await api.auth.logout();
            reset();
            onSignedOut?.();
          }}
        >
          Sign out
        </button>
      }
    >
      <div className="pref-row">
        <div className="grow min-0">
          <div className="pref-label">Other devices</div>
          <div className="pref-hint">
            Where else you are signed in, your password and recent sign-ins.
          </div>
        </div>
        <button className="btn btn-ghost" onClick={() => navigate('/settings/security')}>
          Sign-in &amp; security
        </button>
      </div>
    </Card>
  );
}
