/** What this dashboard remembers between visits, and the guards on reading it back.
 *
 * Every field is re-validated on load rather than trusted. `localStorage` holds whatever
 * an older build wrote, a half-finished edit left, or a person typed into devtools, and
 * one bad widget id would otherwise render an empty grid with no way back.
 */

import {
  METRICS,
  REFRESH_OPTIONS,
  WIDGETS,
  ZOOM_OPTIONS,
  type DashboardPrefs,
  type WidgetId,
  type WidgetSize,
} from "./model.ts";

export const DASHBOARD_PREFS_KEY = "blob.admin.health.dashboard";

export const DEFAULT_PREFS: DashboardPrefs = {
  refreshMs: 2000,
  order: WIDGETS,
  hidden: [],
  sizes: {
    services: "standard",
    metrics: "wide",
    trends: "wide",
    detail: "standard",
    activity: "wide",
  },
  metric: "connections",
  zoom: 24,
};

export function loadPrefs(): DashboardPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(DASHBOARD_PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<DashboardPrefs>;
    return {
      refreshMs:
        parsed.refreshMs && REFRESH_OPTIONS.includes(parsed.refreshMs)
          ? parsed.refreshMs
          : DEFAULT_PREFS.refreshMs,
      order: sanitizeOrder(parsed.order),
      hidden: sanitizeHidden(parsed.hidden),
      sizes: {
        ...DEFAULT_PREFS.sizes,
        ...sanitizeSizes(parsed.sizes),
      },
      metric:
        parsed.metric && METRICS.some((metric) => metric.key === parsed.metric)
          ? parsed.metric
          : DEFAULT_PREFS.metric,
      zoom:
        parsed.zoom && ZOOM_OPTIONS.includes(parsed.zoom)
          ? parsed.zoom
          : DEFAULT_PREFS.zoom,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function sanitizeOrder(order: WidgetId[] | undefined): WidgetId[] {
  const wanted = Array.isArray(order) ? order.filter(isWidgetId) : [];
  const seen = new Set<WidgetId>();
  const sanitized: WidgetId[] = [];
  for (const widget of wanted) {
    if (seen.has(widget)) continue;
    seen.add(widget);
    sanitized.push(widget);
  }
  for (const widget of WIDGETS) {
    if (!seen.has(widget)) sanitized.push(widget);
  }
  return sanitized;
}

function sanitizeHidden(hidden: WidgetId[] | undefined): WidgetId[] {
  return Array.isArray(hidden) ? hidden.filter(isWidgetId) : [];
}

function sanitizeSizes(
  sizes: Record<WidgetId, WidgetSize> | undefined,
): Partial<Record<WidgetId, WidgetSize>> {
  if (!sizes) return {};
  const out: Partial<Record<WidgetId, WidgetSize>> = {};
  for (const widget of WIDGETS) {
    const value = sizes[widget];
    if (value === "standard" || value === "wide") out[widget] = value;
  }
  return out;
}

function isWidgetId(value: unknown): value is WidgetId {
  return typeof value === "string" && WIDGETS.includes(value as WidgetId);
}

export function nextSize(size: WidgetSize): WidgetSize {
  return size === "standard" ? "wide" : "standard";
}

export function moveWidget(order: WidgetId[], widget: WidgetId, direction: -1 | 1): WidgetId[] {
  const index = order.indexOf(widget);
  const nextIndex = index + direction;
  if (index === -1 || nextIndex < 0 || nextIndex >= order.length) return order;
  const next = order.slice();
  const [picked] = next.splice(index, 1);
  next.splice(nextIndex, 0, picked as WidgetId);
  return next;
}
