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
}: {
  label: string;
  value: string;
  bad?: boolean;
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value" data-bad={bad}>
        {value}
      </div>
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
