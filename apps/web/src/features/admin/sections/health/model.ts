/** The health dashboard's vocabulary: what it measures and what it calls things.
 *
 * Split out of a single 1,100-line section so the parts can be read one at a time. This
 * file is the half that has no opinion about React — the metric table is data, and
 * `formatBytes` and `metricByKey` are the two functions that read it.
 */

import { type AdminHealth } from "../../../../lib/api.ts";
import { pathForRoute } from "../../../../lib/router.ts";
import { formatBytes } from "../../../../lib/format.ts";

export type RefreshMs = 500 | 1000 | 2000;
export type ChartZoom = 12 | 24 | 48 | 96;
export type HealthMetricKey =
  | "queueDepth"
  | "connections"
  | "usersOnline"
  | "messageCount"
  | "storageBytes";
export type WidgetId = "services" | "metrics" | "trends" | "detail" | "activity";
export type WidgetSize = "standard" | "wide";
export type FeedKind = "all" | "logs" | "audit";

export interface HealthSample {
  at: string;
  health: AdminHealth;
}

export interface FeedItem {
  id: string;
  kind: "log" | "audit";
  at: string;
  title: string;
  body: string;
  tone: "default" | "warning" | "danger";
}

export interface DashboardPrefs {
  refreshMs: RefreshMs;
  order: WidgetId[];
  hidden: WidgetId[];
  sizes: Record<WidgetId, WidgetSize>;
  metric: HealthMetricKey;
  zoom: ChartZoom;
}

export const REFRESH_OPTIONS: RefreshMs[] = [500, 1000, 2000];
export const ZOOM_OPTIONS: ChartZoom[] = [12, 24, 48, 96];
export const HISTORY_LIMIT = 240;
export const LOG_LIMIT = 10;
export const AUDIT_LIMIT = 10;
export const DASHBOARD_PREFS_KEY = "blob.admin.health.dashboard";
export const WIDGETS: WidgetId[] = [
  "services",
  "metrics",
  "trends",
  "detail",
  "activity",
];

export const METRICS: {
  key: HealthMetricKey;
  label: string;
  description: string;
  route: string;
  feedKind: FeedKind;
  format: (health: AdminHealth) => string;
  raw: (health: AdminHealth) => number;
}[] = [
  {
    key: "queueDepth",
    label: "Queue depth",
    description: "Work waiting in the background queue.",
    route: pathForRoute({ view: "server", section: "logs" }),
    feedKind: "logs",
    format: (health) => String(health.queueDepth),
    raw: (health) => health.queueDepth,
  },
  {
    key: "connections",
    label: "Live sockets",
    description: "Connected websocket sessions in this workspace.",
    route: pathForRoute({ view: "server", section: "health" }),
    feedKind: "logs",
    format: (health) => String(health.connections),
    raw: (health) => health.connections,
  },
  {
    key: "usersOnline",
    label: "People online",
    description: "Distinct signed-in people with an active connection.",
    route: pathForRoute({ view: "server", section: "users" }),
    feedKind: "audit",
    format: (health) => String(health.usersOnline),
    raw: (health) => health.usersOnline,
  },
  {
    key: "messageCount",
    label: "Messages",
    description: "Stored, non-deleted messages in this workspace.",
    route: pathForRoute({ view: "admin", section: "audit" }),
    feedKind: "audit",
    format: (health) => health.messageCount.toLocaleString(),
    raw: (health) => health.messageCount,
  },
  {
    key: "storageBytes",
    label: "Stored files",
    description: "Attachment bytes currently kept for this workspace.",
    route: pathForRoute({ view: "server", section: "logs" }),
    feedKind: "logs",
    format: (health) => formatBytes(health.storageBytes),
    raw: (health) => health.storageBytes,
  },
];

export function metricByKey(key: HealthMetricKey) {
  return METRICS.find((metric) => metric.key === key) ?? METRICS[0]!;
}

/** A day and a bit: a nightly backup older than this missed a night. */
const BACKUP_STALE_MS = 26 * 60 * 60 * 1000;

/** The Backups tile (M3 · B4): how the last nightly backup went, said so an admin can act
 *  on it — off, not yet, failing, gone stale, or fine. */
export function backupTile(
  backup: AdminHealth["backup"],
  now: number = Date.now(),
): { value: string; bad: boolean; hint?: string } {
  if (!backup || !backup.enabled) {
    return { value: "Off", bad: true, hint: "Nothing is backing up the database (BACKUP_ENABLED)." };
  }
  if (!backup.at) {
    return { value: "None yet", bad: false, hint: "The first one runs tonight." };
  }
  if (!backup.ok) {
    return { value: "Failing", bad: true, hint: backup.error ?? "The last backup did not finish." };
  }
  const age = now - Date.parse(backup.at);
  const hours = Math.max(0, Math.round(age / 3_600_000));
  const ago = hours < 1 ? "just now" : hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const size = backup.bytes !== null ? formatBytes(backup.bytes) : "";
  if (age > BACKUP_STALE_MS) {
    return { value: `${size}, ${ago}`, bad: true, hint: "No backup in more than a day." };
  }
  return { value: size ? `${size}, ${ago}` : ago, bad: false };
}
