/** Where you are signed in, and the way out.
 *
 * The last part of the You page, because it is the one control here that ends the
 * session rather than changing a setting — and because "sign out" sitting in the middle
 * of a page of preferences is a button nobody wants to find by accident.
 */

import { useState } from "react";
import { api, type AuthSession } from "../../lib/api.ts";
import { useStore } from "../../lib/store.ts";
import { useFetch } from "../../lib/useFetch.ts";
import { showError } from "../../lib/toasts.ts";
import type { ConsoleSectionProps } from "../console/ConsoleShell.tsx";

export function AccountCard({ onSignedOut }: ConsoleSectionProps) {
  const reset = useStore((s) => s.reset);

  return (
    <>
      <h2 className="section-label m-0">Where you’re signed in</h2>
      <DevicesPanel />

      <div className="account-actions">
        <button
          className="btn"
          onClick={async () => {
            await api.auth.logout();
            reset();
            onSignedOut?.();
          }}
        >
          Sign out
        </button>
      </div>
    </>
  );
}

function DevicesPanel() {
  const [revoking, setRevoking] = useState(false);
  const { data: sessions, error } = useFetch(
    async (): Promise<AuthSession[]> => (await api.auth.sessions()).sessions,
    [revoking],
  );

  if (error) return <p className="error-text">Could not load your sessions.</p>;
  if (sessions === null) return <p className="pref-hint">Loading…</p>;

  const others = sessions.filter((s) => !s.current);
  return (
    <div style={{ marginTop: 12 }}>
      {sessions.map((session) => (
        <div key={session.id} className="pref-row" style={{ padding: '10px 0' }}>
          <div className="grow min-0">
            <div className="pref-label">
              {describeAgent(session.userAgent)}
              {session.current && ' — this device'}
            </div>
            <div className="pref-hint">
              {session.ip ? `${session.ip} · ` : ''}last seen{' '}
              {new Date(session.lastSeenAt).toLocaleString()}
            </div>
          </div>
        </div>
      ))}
      {others.length > 0 && (
        <button
          className="btn"
          disabled={revoking}
          onClick={async () => {
            setRevoking(true);
            try {
              await api.auth.logoutOthers();
            } catch (err) {
              showError(err);
            } finally {
              setRevoking(false);
            }
          }}
        >
          Sign out everywhere else
        </button>
      )}
    </div>
  );
}

/** "Chrome on macOS", best effort, because a raw user-agent string helps nobody. */
function describeAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser = userAgent.includes('Firefox/')
    ? 'Firefox'
    : userAgent.includes('Edg/')
      ? 'Edge'
      : userAgent.includes('Chrome/')
        ? 'Chrome'
        : userAgent.includes('Safari/')
          ? 'Safari'
          : 'Browser';
  const os = userAgent.includes('Mac OS X')
    ? 'macOS'
    : userAgent.includes('Windows')
      ? 'Windows'
      : userAgent.includes('Android')
        ? 'Android'
        : /iPhone|iPad/.test(userAgent)
          ? 'iOS'
          : userAgent.includes('Linux')
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}
