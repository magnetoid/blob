/** The health dashboard's vocabulary: what it measures and what it calls things.
 *
 * Split out of a single 1,100-line section so the parts can be read one at a time. This
 * file is the half that has no opinion about React — the metric table is data, and
 * `formatBytes` and `metricByKey` are the two functions that read it.
 */

import { type AdminHealth } from "../../../../lib/api.ts";
import { pathForRoute } from "../../../../lib/router.ts";

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
    route: pathForRoute({ view: "admin", section: "logs" }),
    feedKind: "logs",
    format: (health) => String(health.queueDepth),
    raw: (health) => health.queueDepth,
  },
  {
    key: "connections",
    label: "Live sockets",
    description: "Connected websocket sessions in this workspace.",
    route: pathForRoute({ view: "admin", section: "health" }),
    feedKind: "logs",
    format: (health) => String(health.connections),
    raw: (health) => health.connections,
  },
  {
    key: "usersOnline",
    label: "People online",
    description: "Distinct signed-in people with an active connection.",
    route: pathForRoute({ view: "admin", section: "users" }),
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
    route: pathForRoute({ view: "admin", section: "logs" }),
    feedKind: "logs",
    format: (health) => formatBytes(health.storageBytes),
    raw: (health) => health.storageBytes,
  },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function metricByKey(key: HealthMetricKey) {
  return METRICS.find((metric) => metric.key === key) ?? METRICS[0]!;
}
