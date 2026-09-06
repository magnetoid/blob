/** Whether the parts this workspace runs on are answering. */

import { useCallback } from "react";
import { api } from "../../../lib/api.ts";
import { useAdminData } from "../hooks.ts";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function Stat({
  label,
  value,
  bad,
  hint,
}: {
  label: string;
  value: string;
  bad?: boolean;
  /** What to do about it, shown only when there is something to do. */
  hint?: string;
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value" data-bad={bad}>
        {value}
      </div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function HealthSection({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const load = useCallback(() => api.admin.health(), []);
  const { data: health, loading } = useAdminData(
    load,
    [],
    onError,
    "Health unavailable.",
  );

  if (!health) {
    return (
      <p className="muted">{loading ? "Checking…" : "Health unavailable."}</p>
    );
  }

  return (
    <section>
      <div className="health-grid">
        <Stat
          label="Database"
          value={health.database ? "Reachable" : "Down"}
          bad={!health.database}
        />
        <Stat
          label="Redis"
          value={health.redis ? "Reachable" : "Down"}
          bad={!health.redis}
        />
        {/* The two ways something can reach a person who is not looking at the app.
            Both fail silently by design — a dead mail server must not fail the request
            that triggered it — so this is the only place they are visible. */}
        <Stat
          label="Email"
          value={
            health.mail === 'ok'
              ? 'Reachable'
              : health.mail === 'unconfigured'
                ? 'Not configured'
                : 'Unreachable'
          }
          bad={health.mail !== 'ok'}
          hint={
            health.mail === 'ok'
              ? undefined
              : 'Invitations and password resets are not being delivered. Set SMTP_HOST, SMTP_PORT and MAIL_FROM.'
          }
        />
        <Stat
          label="Push notifications"
          value={health.push ? 'On' : 'No keys'}
          bad={!health.push}
          hint={
            health.push
              ? undefined
              : 'Nobody can be notified while their tab is closed. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.'
          }
        />
        <Stat label="Queue depth" value={String(health.queueDepth)} />
        <Stat label="Live sockets" value={String(health.connections)} />
        <Stat label="People online" value={String(health.usersOnline)} />
        <Stat label="Messages" value={health.messageCount.toLocaleString()} />
        <Stat label="Stored files" value={formatBytes(health.storageBytes)} />
        <Stat label="Version" value={health.version} />
      </div>
    </section>
  );
}
