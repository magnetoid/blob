/** An interactive operations dashboard over the server health snapshot. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type AdminHealth,
  type AuditEvent,
  type ServerLogEntry,
} from "../../../lib/api.ts";
import { socket } from "../../../lib/socket.ts";
import { navigate, pathForRoute } from "../../../lib/router.ts";
import { formatRelative } from "../../messages/messageFormatting.ts";

type RefreshMs = 500 | 1000 | 2000;
type ChartZoom = 12 | 24 | 48 | 96;
type HealthMetricKey =
  | "queueDepth"
  | "connections"
  | "usersOnline"
  | "messageCount"
  | "storageBytes";
type WidgetId = "services" | "metrics" | "trends" | "detail" | "activity";
type WidgetSize = "standard" | "wide";
type FeedKind = "all" | "logs" | "audit";

interface HealthSample {
  at: string;
  health: AdminHealth;
}

interface FeedItem {
  id: string;
  kind: "log" | "audit";
  at: string;
  title: string;
  body: string;
  tone: "default" | "warning" | "danger";
}

interface DashboardPrefs {
  refreshMs: RefreshMs;
  order: WidgetId[];
  hidden: WidgetId[];
  sizes: Record<WidgetId, WidgetSize>;
  metric: HealthMetricKey;
  zoom: ChartZoom;
}

const REFRESH_OPTIONS: RefreshMs[] = [500, 1000, 2000];
const ZOOM_OPTIONS: ChartZoom[] = [12, 24, 48, 96];
const HISTORY_LIMIT = 240;
const LOG_LIMIT = 10;
const AUDIT_LIMIT = 10;
const DASHBOARD_PREFS_KEY = "blob.admin.health.dashboard";
const WIDGETS: WidgetId[] = [
  "services",
  "metrics",
  "trends",
  "detail",
  "activity",
];

const DEFAULT_PREFS: DashboardPrefs = {
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

const METRICS: {
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

function loadPrefs(): DashboardPrefs {
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

function nextSize(size: WidgetSize): WidgetSize {
  return size === "standard" ? "wide" : "standard";
}

function moveWidget(order: WidgetId[], widget: WidgetId, direction: -1 | 1): WidgetId[] {
  const index = order.indexOf(widget);
  const nextIndex = index + direction;
  if (index === -1 || nextIndex < 0 || nextIndex >= order.length) return order;
  const next = order.slice();
  const [picked] = next.splice(index, 1);
  next.splice(nextIndex, 0, picked as WidgetId);
  return next;
}

function metricByKey(key: HealthMetricKey) {
  return METRICS.find((metric) => metric.key === key) ?? METRICS[0]!;
}

function normalizeLevel(level: string): FeedItem["tone"] {
  const lowered = level.toLowerCase();
  if (lowered === "error" || lowered === "critical") return "danger";
  if (lowered === "warning") return "warning";
  return "default";
}

function sampleLabel(sample: HealthSample): string {
  return new Date(sample.at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function chartWindow(history: HealthSample[], zoom: ChartZoom, offset: number): HealthSample[] {
  if (history.length <= zoom) return history;
  const maxOffset = Math.max(0, history.length - zoom);
  const boundedOffset = Math.min(offset, maxOffset);
  const start = Math.max(0, history.length - zoom - boundedOffset);
  return history.slice(start, start + zoom);
}

function deltaForMetric(metric: HealthMetricKey, history: HealthSample[]): number | null {
  if (history.length < 2) return null;
  const current = metricByKey(metric).raw(history[history.length - 1]!.health);
  const previous = metricByKey(metric).raw(history[history.length - 2]!.health);
  return current - previous;
}

function DashboardWidget({
  title,
  description,
  size,
  loading,
  controls,
  children,
}: {
  title: string;
  description: string;
  size: WidgetSize;
  loading?: boolean;
  controls: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="dashboard-widget"
      data-size={size}
      data-loading={loading ? "true" : "false"}
    >
      <header className="dashboard-widget-head">
        <div>
          <h2 className="dashboard-widget-title">{title}</h2>
          <p className="dashboard-widget-subtitle">{description}</p>
        </div>
        <div className="dashboard-widget-controls">{controls}</div>
      </header>
      <div className="dashboard-widget-body">{children}</div>
    </section>
  );
}

function WidgetControls({
  widget,
  size,
  canMoveLeft,
  canMoveRight,
  onMove,
  onResize,
  onHide,
}: {
  widget: WidgetId;
  size: WidgetSize;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMove: (direction: -1 | 1) => void;
  onResize: () => void;
  onHide: () => void;
}) {
  return (
    <div className="dashboard-widget-buttons">
      <button
        type="button"
        className="chip dashboard-chip-btn"
        onClick={() => onMove(-1)}
        disabled={!canMoveLeft}
        aria-label={`Move ${widget} earlier`}
      >
        Move earlier
      </button>
      <button
        type="button"
        className="chip dashboard-chip-btn"
        onClick={() => onMove(1)}
        disabled={!canMoveRight}
        aria-label={`Move ${widget} later`}
      >
        Move later
      </button>
      <button
        type="button"
        className="chip dashboard-chip-btn"
        onClick={onResize}
        aria-label={`Set ${widget} widget to ${
          size === "wide" ? "standard" : "wide"
        } size`}
      >
        {size === "wide" ? "Standard width" : "Wide"}
      </button>
      <button
        type="button"
        className="chip dashboard-chip-btn"
        onClick={onHide}
        aria-label={`Hide ${widget} widget`}
      >
        Remove
      </button>
    </div>
  );
}

function ServiceTile({
  label,
  value,
  bad,
  hint,
  route,
}: {
  label: string;
  value: string;
  bad?: boolean;
  hint?: string;
  route: string;
}) {
  return (
    <button
      type="button"
      className="stat stat-button"
      onClick={() => navigate(route)}
    >
      <span className="stat-label">{label}</span>
      <span className="stat-value" data-bad={bad}>
        {value}
      </span>
      {hint && <span className="stat-hint">{hint}</span>}
    </button>
  );
}

function MetricCard({
  metric,
  health,
  active,
  delta,
  onSelect,
}: {
  metric: (typeof METRICS)[number];
  health: AdminHealth;
  active: boolean;
  delta: number | null;
  onSelect: () => void;
}) {
  const trend =
    delta === null
      ? "Waiting for another sample."
      : delta === 0
        ? "No change since the previous sample."
        : `${delta > 0 ? "+" : ""}${delta.toLocaleString()} since the previous sample.`;

  return (
    <button
      type="button"
      className="dashboard-metric"
      data-active={active ? "true" : "false"}
      onClick={onSelect}
      aria-pressed={active}
      aria-label={`Focus ${metric.label}`}
    >
      <span className="dashboard-metric-label">{metric.label}</span>
      <span className="dashboard-metric-value">{metric.format(health)}</span>
      <span className="dashboard-metric-detail">{metric.description}</span>
      <span className="dashboard-metric-trend">{trend}</span>
    </button>
  );
}

function TrendChart({
  metric,
  history,
  zoom,
  offset,
  selectedSampleAt,
  onSelectMetric,
  onOffsetChange,
  onSelectSample,
  onZoom,
}: {
  metric: HealthMetricKey;
  history: HealthSample[];
  zoom: ChartZoom;
  offset: number;
  selectedSampleAt: string | null;
  onSelectMetric: (metric: HealthMetricKey) => void;
  onOffsetChange: (offset: number) => void;
  onSelectSample: (sampleAt: string | null) => void;
  onZoom: (zoom: ChartZoom) => void;
}) {
  const metricDef = metricByKey(metric);
  const visible = chartWindow(history, zoom, offset);
  const values = visible.map((sample) => metricDef.raw(sample.health));
  const max = Math.max(...values, 1);
  const [hoveredSampleAt, setHoveredSampleAt] = useState<string | null>(null);
  const gestureStart = useRef<number | null>(null);

  const currentSample =
    visible.find((sample) => sample.at === hoveredSampleAt) ??
    visible.find((sample) => sample.at === selectedSampleAt) ??
    visible[visible.length - 1] ??
    null;

  const moveWindow = useCallback(
    (direction: -1 | 1) => {
      if (history.length <= zoom) return;
      const maxOffset = Math.max(0, history.length - zoom);
      const step = Math.max(1, Math.floor(zoom / 2));
      const next =
        direction === -1
          ? Math.min(maxOffset, offset + step)
          : Math.max(0, offset - step);
      onOffsetChange(next);
    },
    [history.length, offset, onOffsetChange, zoom],
  );

  return (
    <div className="dashboard-chart">
      <div className="dashboard-chart-toolbar">
        <div className="chip-row">
          {METRICS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className="chip"
              aria-pressed={metric === entry.key}
              onClick={() => onSelectMetric(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="dashboard-chart-actions">
          <label className="dashboard-inline-control">
            <span>Window</span>
            <select
              className="select"
              value={zoom}
              onChange={(event) => onZoom(Number(event.target.value) as ChartZoom)}
            >
              {ZOOM_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} points
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => moveWindow(-1)}
            disabled={history.length <= zoom}
          >
            Older
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => moveWindow(1)}
            disabled={history.length <= zoom}
          >
            Newer
          </button>
        </div>
      </div>

      <div className="dashboard-chart-summary" aria-live="polite">
        {currentSample ? (
          <>
            <strong>{metricDef.label}</strong> was{" "}
            {metricDef.format(currentSample.health)} at {sampleLabel(currentSample)}.
            {selectedSampleAt === currentSample.at &&
              " Activity is currently filtered to items after this point."}
          </>
        ) : (
          "Waiting for enough live data to draw a chart."
        )}
      </div>

      <div
        className="dashboard-chart-plot"
        onPointerDown={(event) => {
          gestureStart.current = event.clientX;
        }}
        onPointerUp={(event) => {
          if (gestureStart.current === null) return;
          const delta = event.clientX - gestureStart.current;
          gestureStart.current = null;
          if (Math.abs(delta) < 40) return;
          moveWindow(delta < 0 ? -1 : 1);
        }}
      >
        {visible.length === 0 ? (
          <div className="dashboard-empty">Waiting for the first live sample…</div>
        ) : (
          visible.map((sample) => {
            const value = metricDef.raw(sample.health);
            const percent = `${Math.max(8, Math.round((value / max) * 100))}%`;
            const active = selectedSampleAt === sample.at;
            return (
              <button
                key={sample.at}
                type="button"
                className="dashboard-bar"
                data-active={active ? "true" : "false"}
                style={{ height: percent }}
                aria-label={`${metricDef.label} at ${sampleLabel(sample)}: ${metricDef.format(
                  sample.health,
                )}`}
                title={`${metricDef.label}: ${metricDef.format(sample.health)} at ${sampleLabel(
                  sample,
                )}`}
                onMouseEnter={() => setHoveredSampleAt(sample.at)}
                onFocus={() => setHoveredSampleAt(sample.at)}
                onMouseLeave={() => setHoveredSampleAt(null)}
                onBlur={() => setHoveredSampleAt(null)}
                onClick={() =>
                  onSelectSample(active ? null : sample.at)
                }
              >
                <span className="sr-only">{sampleLabel(sample)}</span>
              </button>
            );
          })
        )}
      </div>

      <div className="dashboard-chart-footer">
        <span>Swipe left or right on touch screens to pan the chart.</span>
        {selectedSampleAt && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onSelectSample(null)}
          >
            Clear chart filter
          </button>
        )}
      </div>
    </div>
  );
}

function ActivityFeed({
  items,
  kind,
  onKindChange,
}: {
  items: FeedItem[];
  kind: FeedKind;
  onKindChange: (kind: FeedKind) => void;
}) {
  return (
    <div className="dashboard-feed">
      <div className="chip-row">
        {[
          { label: "Everything", value: "all" as const },
          { label: "Logs", value: "logs" as const },
          { label: "Audit", value: "audit" as const },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            className="chip"
            aria-pressed={kind === option.value}
            onClick={() => onKindChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="dashboard-feed-list">
        {items.length === 0 ? (
          <p className="muted">No items match the current filters.</p>
        ) : (
          items.map((item) => (
            <article key={item.id} className="dashboard-feed-item" data-tone={item.tone}>
              <div className="dashboard-feed-topline">
                <span className="role-pill" data-muted={item.kind === "audit" ? "true" : undefined}>
                  {item.kind === "log" ? "Log" : "Audit"}
                </span>
                <span>{formatRelative(item.at)}</span>
              </div>
              <div className="dashboard-feed-title">{item.title}</div>
              <div className="dashboard-feed-body">{item.body}</div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}

export function HealthSection({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const [prefs, setPrefs] = useState<DashboardPrefs>(loadPrefs);
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [history, setHistory] = useState<HealthSample[]>([]);
  const [logs, setLogs] = useState<ServerLogEntry[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSampleAt, setSelectedSampleAt] = useState<string | null>(null);
  const [feedKind, setFeedKind] = useState<FeedKind>("all");
  const [panOffset, setPanOffset] = useState(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const fetchSeq = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(DASHBOARD_PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Storage can be unavailable in private browsing or restricted environments.
    }
  }, [prefs]);

  const loadDashboard = useCallback(
    async (reason: "initial" | "refresh" = "refresh") => {
      const seq = ++fetchSeq.current;
      if (reason === "initial") setLoading(true);
      else setRefreshing(true);
      onError(null);
      try {
        const [nextHealth, nextLogs, nextAudit] = await Promise.all([
          api.admin.health(),
          api.admin.serverLogs({ limit: LOG_LIMIT }),
          api.admin.audit({ limit: AUDIT_LIMIT }),
        ]);
        if (fetchSeq.current !== seq) return;
        const now = new Date().toISOString();
        setHealth(nextHealth);
        setLogs(nextLogs.entries);
        setAudit(nextAudit.events);
        setLastUpdatedAt(now);
        setHistory((current) => {
          const next = [...current, { at: now, health: nextHealth }];
          return next.slice(-HISTORY_LIMIT);
        });
      } catch (err) {
        if (fetchSeq.current !== seq) return;
        const message = err instanceof Error ? err.message : "Health unavailable.";
        onError(message);
      } finally {
        if (fetchSeq.current === seq) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [onError],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDashboard("initial");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void loadDashboard();
    }, prefs.refreshMs);
    return () => clearInterval(timer);
  }, [loadDashboard, prefs.refreshMs]);

  useEffect(() => {
    let queued = false;
    const requestRefresh = () => {
      if (queued) return;
      queued = true;
      window.setTimeout(() => {
        queued = false;
        void loadDashboard();
      }, 200);
    };

    const unsubscribe = socket.subscribe((event) => {
      if (event.t === "hello" || event.t === "pong") return;
      requestRefresh();
    });
    const unsubscribeStatus = socket.onStatus((status) => {
      if (status === "online") requestRefresh();
    });
    return () => {
      unsubscribe();
      unsubscribeStatus();
    };
  }, [loadDashboard]);

  const activeMetric = metricByKey(prefs.metric);
  const delta = deltaForMetric(prefs.metric, history);
  const hiddenWidgets = prefs.hidden.filter((widget) => WIDGETS.includes(widget));
  const visibleWidgets = prefs.order.filter((widget) => !hiddenWidgets.includes(widget));

  const feedItems = useMemo(() => {
    const combined: FeedItem[] = [
      ...logs.map((entry, index) => ({
        id: `log-${entry.at}-${index}`,
        kind: "log" as const,
        at: entry.at,
        title: entry.message,
        body: [entry.logger, entry.path ? `${entry.method} ${entry.path}` : null]
          .filter(Boolean)
          .join(" · "),
        tone: normalizeLevel(entry.level),
      })),
      ...audit.map((event) => ({
        id: `audit-${event.id}`,
        kind: "audit" as const,
        at: event.createdAt,
        title: event.action.replace(/\./g, " "),
        body: [
          event.actorName ?? "Someone",
          event.targetLabel,
          Object.keys(event.metadata).length > 0
            ? Object.entries(event.metadata)
                .map(([key, value]) => `${key}: ${String(value)}`)
                .join(", ")
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
        tone: "default" as const,
      })),
    ]
      .sort((left, right) => right.at.localeCompare(left.at))
      .filter((item) => {
        if (feedKind === "all") return true;
        return feedKind === "logs" ? item.kind === "log" : item.kind === "audit";
      })
      .filter((item) => (selectedSampleAt ? item.at >= selectedSampleAt : true));

    return combined.slice(0, 8);
  }, [audit, feedKind, logs, selectedSampleAt]);

  function controlsFor(widget: WidgetId) {
    return (
      <WidgetControls
        widget={widget}
        size={prefs.sizes[widget]}
        canMoveLeft={visibleWidgets.indexOf(widget) > 0}
        canMoveRight={visibleWidgets.indexOf(widget) < visibleWidgets.length - 1}
        onMove={(direction) =>
          setPrefs((current) => ({
            ...current,
            order: moveWidget(current.order, widget, direction),
          }))
        }
        onResize={() =>
          setPrefs((current) => ({
            ...current,
            sizes: {
              ...current.sizes,
              [widget]: nextSize(current.sizes[widget]),
            },
          }))
        }
        onHide={() =>
          setPrefs((current) => ({
            ...current,
            hidden: current.hidden.includes(widget)
              ? current.hidden
              : [...current.hidden, widget],
          }))
        }
      />
    );
  }

  if (!health && loading) {
    return (
      <section className="dashboard-dashboard">
        <div className="dashboard-toolbar">
          <h2 className="page-title" style={{ margin: 0 }}>
            Health dashboard
          </h2>
        </div>
        <div className="dashboard-grid">
          {["services", "metrics", "trends"].map((card) => (
            <div key={card} className="dashboard-widget" data-loading="true">
              <div className="dashboard-loading-block" />
              <div className="dashboard-loading-block dashboard-loading-block-short" />
              <div className="dashboard-loading-block" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (!health) {
    return <p className="muted">Health unavailable.</p>;
  }

  return (
    <section className="dashboard-dashboard">
      <div className="dashboard-toolbar">
        <div>
          <div className="dashboard-eyebrow">Operations dashboard</div>
          <div className="dashboard-toolbar-title">
            Health, live activity, and quick drill-downs in one place.
          </div>
          <div className="dashboard-toolbar-subtitle" aria-live="polite">
            {lastUpdatedAt
              ? `Last updated ${formatRelative(lastUpdatedAt)}.`
              : "Waiting for the first live sample."}
            {refreshing && " Refreshing now…"}
          </div>
        </div>

        <div className="dashboard-toolbar-actions">
          <label className="dashboard-inline-control">
            <span>Refresh</span>
            <select
              className="select"
              value={prefs.refreshMs}
              onChange={(event) =>
                setPrefs((current) => ({
                  ...current,
                  refreshMs: Number(event.target.value) as RefreshMs,
                }))
              }
            >
              {REFRESH_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  Every {option / 1000}s
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setPrefs(DEFAULT_PREFS);
              setPanOffset(0);
              setSelectedSampleAt(null);
              setFeedKind("all");
            }}
          >
            Reset layout
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void loadDashboard()}
          >
            Refresh now
          </button>
        </div>
      </div>

      {hiddenWidgets.length > 0 && (
        <div className="dashboard-hidden">
          <span className="dashboard-hidden-label">Hidden widgets</span>
          <div className="chip-row">
            {hiddenWidgets.map((widget) => (
              <button
                key={widget}
                type="button"
                className="chip"
                onClick={() =>
                  setPrefs((current) => ({
                    ...current,
                    hidden: current.hidden.filter((entry) => entry !== widget),
                  }))
                }
              >
                Add {widget}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="dashboard-grid">
        {visibleWidgets.map((widget) => {
          if (widget === "services") {
            return (
              <DashboardWidget
                key={widget}
                title="Service status"
                description="Every dependency the server needs to answer."
                size={prefs.sizes[widget]}
                loading={refreshing}
                controls={controlsFor(widget)}
              >
                <div className="health-grid dashboard-service-grid">
                  <ServiceTile
                    label="Database"
                    value={health.database ? "Reachable" : "Down"}
                    bad={!health.database}
                    route={pathForRoute({ view: "admin", section: "logs" })}
                  />
                  <ServiceTile
                    label="Redis"
                    value={health.redis ? "Reachable" : "Down"}
                    bad={!health.redis}
                    route={pathForRoute({ view: "admin", section: "logs" })}
                  />
                  <ServiceTile
                    label="Email"
                    value={
                      health.mail === "ok"
                        ? "Reachable"
                        : health.mail === "unconfigured"
                          ? "Not configured"
                          : "Unreachable"
                    }
                    bad={health.mail !== "ok"}
                    hint={
                      health.mail === "ok"
                        ? undefined
                        : "Open logs for delivery failures and SMTP setup clues."
                    }
                    route={pathForRoute({ view: "admin", section: "logs" })}
                  />
                  <ServiceTile
                    label="Push"
                    value={health.push ? "On" : "No keys"}
                    bad={!health.push}
                    hint={
                      health.push ? undefined : "Closed-tab notifications are currently off."
                    }
                    route={pathForRoute({ view: "admin", section: "logs" })}
                  />
                  <ServiceTile
                    label="File uploads"
                    value={
                      health.storage === "ok"
                        ? "Working"
                        : health.storage === "unconfigured"
                          ? "No address"
                          : health.storage === "private"
                            ? "Not public"
                            : "Unreachable"
                    }
                    bad={health.storage !== "ok"}
                    hint={
                      health.storage === "ok"
                        ? undefined
                        : "Open logs for the most recent object storage failures."
                    }
                    route={pathForRoute({ view: "admin", section: "logs" })}
                  />
                </div>
              </DashboardWidget>
            );
          }

          if (widget === "metrics") {
            return (
              <DashboardWidget
                key={widget}
                title="Summary metrics"
                description="Click a card to focus the chart and open the relevant drill-down."
                size={prefs.sizes[widget]}
                loading={refreshing}
                controls={controlsFor(widget)}
              >
                <div className="dashboard-metrics-grid">
                  {METRICS.map((metric) => (
                    <MetricCard
                      key={metric.key}
                      metric={metric}
                      health={health}
                      active={prefs.metric === metric.key}
                      delta={deltaForMetric(metric.key, history)}
                      onSelect={() => {
                        setPrefs((current) => ({
                          ...current,
                          metric: metric.key,
                        }));
                        setFeedKind(metric.feedKind);
                      }}
                    />
                  ))}
                </div>
              </DashboardWidget>
            );
          }

          if (widget === "trends") {
            return (
              <DashboardWidget
                key={widget}
                title="Realtime trends"
                description="Socket activity triggers refreshes, while the interval guarantees a fresh sample within two seconds."
                size={prefs.sizes[widget]}
                loading={refreshing}
                controls={controlsFor(widget)}
              >
                <TrendChart
                  metric={prefs.metric}
                  history={history}
                  zoom={prefs.zoom}
                  offset={panOffset}
                  selectedSampleAt={selectedSampleAt}
                  onSelectMetric={(metric) =>
                    setPrefs((current) => ({ ...current, metric }))
                  }
                  onOffsetChange={setPanOffset}
                  onSelectSample={setSelectedSampleAt}
                  onZoom={(zoom) => {
                    setPrefs((current) => ({ ...current, zoom }));
                    setPanOffset(0);
                  }}
                />
              </DashboardWidget>
            );
          }

          if (widget === "detail") {
            return (
              <DashboardWidget
                key={widget}
                title={`${activeMetric.label} detail`}
                description="Drill into the currently selected summary metric."
                size={prefs.sizes[widget]}
                loading={refreshing}
                controls={controlsFor(widget)}
              >
                <div className="dashboard-detail">
                  <div className="dashboard-detail-value">
                    {activeMetric.format(health)}
                  </div>
                  <div className="dashboard-detail-copy">
                    {activeMetric.description}
                  </div>
                  <div className="dashboard-detail-copy">
                    {delta === null
                      ? "The dashboard is still collecting enough samples to calculate change."
                      : delta === 0
                        ? "This metric is flat across the last two samples."
                        : `Change over the latest sample: ${
                            delta > 0 ? "+" : ""
                          }${delta.toLocaleString()}.`}
                  </div>
                  <div className="dashboard-detail-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => navigate(activeMetric.route)}
                    >
                      Open detailed report
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() =>
                        navigate(pathForRoute({ view: "admin", section: "health" }))
                      }
                    >
                      Stay on dashboard
                    </button>
                  </div>
                  {selectedSampleAt && (
                    <div className="dashboard-callout">
                      Activity is filtered to entries after {sampleLabel({
                        at: selectedSampleAt,
                        health,
                      })}
                      . Clear that in the trend widget to return to the full feed.
                    </div>
                  )}
                </div>
              </DashboardWidget>
            );
          }

          return (
            <DashboardWidget
              key={widget}
              title="Recent activity"
              description="Logs and audit events in one stream, filterable from the chart."
              size={prefs.sizes[widget]}
              loading={refreshing}
              controls={controlsFor(widget)}
            >
              <ActivityFeed
                items={feedItems}
                kind={feedKind}
                onKindChange={setFeedKind}
              />
            </DashboardWidget>
          );
        })}
      </div>
    </section>
  );
}
