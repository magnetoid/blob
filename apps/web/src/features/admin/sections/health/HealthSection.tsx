/** An interactive operations dashboard over the server health snapshot.
 *
 * This file is now the composition only: it polls, keeps the sample history, and lays
 * the widgets out in the order the person put them in. What each widget *is* lives
 * beside it — `model.ts` for the vocabulary, `prefs.ts` for what is remembered,
 * `series.ts` for the sample maths, and one file per panel. It was a single 1,143-line
 * section before, which is roughly three times the next largest page in this console.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type AdminHealth,
  type AuditEvent,
  type ServerLogEntry,
} from "../../../../lib/api.ts";
import { socket } from "../../../../lib/socket.ts";
import { navigate, pathForRoute } from "../../../../lib/router.ts";
import { formatRelative } from "../../../messages/messageFormatting.ts";
import { ActivityFeed } from "./ActivityFeed.tsx";
import {
  AUDIT_LIMIT,
  HISTORY_LIMIT,
  LOG_LIMIT,
  METRICS,
  REFRESH_OPTIONS,
  WIDGETS,
  metricByKey,
  type DashboardPrefs,
  type FeedItem,
  type FeedKind,
  type HealthSample,
  type RefreshMs,
  type WidgetId,
} from "./model.ts";
import {
  DASHBOARD_PREFS_KEY,
  DEFAULT_PREFS,
  loadPrefs,
  moveWidget,
  nextSize,
} from "./prefs.ts";
import { deltaForMetric, normalizeLevel, sampleLabel } from "./series.ts";
import { MetricCard, ServiceTile } from "./Tiles.tsx";
import { TrendChart } from "./TrendChart.tsx";
import { DashboardWidget, WidgetControls } from "./Widget.tsx";

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
          <h2 className="page-title m-0">
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
