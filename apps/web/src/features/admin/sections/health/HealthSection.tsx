/** An interactive operations dashboard over the server health snapshot.
 *
 * This file is now the composition only: it polls, keeps the sample history, and lays
 * the widgets out in the order the person put them in. What each widget *is* lives
 * beside it — `model.ts` for the vocabulary, `prefs.ts` for what is remembered,
 * `series.ts` for the sample maths, and one file per panel. It was a single 1,143-line
 * section before, which is roughly three times the next largest page in this console.
 */

import { BrowserErrors } from './BrowserErrors.tsx';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  api,
  type AdminHealth,
  type AuditEvent,
  type ServerLogEntry,
} from "../../../../lib/api.ts";
import { socket } from "../../../../lib/socket.ts";
import { showError, useToasts } from "../../../../lib/toasts.ts";
import { Button } from "../../../../components/ui/button.tsx";
import { Alert, AlertDescription } from "../../../../components/ui/alert.tsx";
import { Label } from "../../../../components/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "../../../../components/ui/native-select.tsx";
import { Skeleton } from "../../../../components/ui/skeleton.tsx";
import { Card, CardNotice } from "../../../console/Card.tsx";
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
  backupTile,
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
  isInstanceAdmin = false,
}: {
  onError: (message: string | null) => void;
  /** The server's log is `require_instance_admin`; the rest of the page is any admin's. */
  isInstanceAdmin?: boolean;
}) {
  const logsRoute = isInstanceAdmin
    ? pathForRoute({ view: "server", section: "logs" })
    : undefined;
  const logsHint = (what: string) =>
    isInstanceAdmin
      ? `Open logs for ${what}.`
      : `The server's administrator can see ${what} in its logs.`;
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
  // The move, resize and remove buttons are for arranging the page, which is rare; out
  // on every panel all the time, they were most of what the page showed.
  const [arranging, setArranging] = useState(false);
  const fetchSeq = useRef(0);
  const refreshId = useId();

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
          // Asked only of whoever may read it. In the same Promise.all it used to fail
          // the whole page for every other admin — "Health unavailable", every few seconds.
          isInstanceAdmin
            ? api.admin.serverLogs({ limit: LOG_LIMIT })
            : Promise.resolve({ entries: [] as ServerLogEntry[] }),
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
    [isInstanceAdmin, onError],
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
    if (!arranging) return null;
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
      <div className="flex flex-col gap-6">
        <p className="m-0 text-sm text-muted-foreground">Waiting for the first live sample.</p>
        <div className="grid grid-cols-1 gap-6 @min-[961px]/console-page:grid-cols-3">
          {["services", "metrics", "trends"].map((card) => (
            <Card key={card} aria-busy="true">
              <Skeleton className="h-4.5 w-full" />
              <Skeleton className="h-4.5 w-3/5" />
              <Skeleton className="h-4.5 w-full" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!health) {
    return (
      <div className="flex flex-col gap-6">
        <Card>
          <CardNotice>Health unavailable.</CardNotice>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-sm text-muted-foreground" aria-live="polite">
          {lastUpdatedAt
            ? `Last updated ${formatRelative(lastUpdatedAt)}.`
            : "Waiting for the first live sample."}
          {refreshing && " Refreshing now…"}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2">
            <Label htmlFor={refreshId} className="text-muted-foreground">
              Refresh
            </Label>
            <NativeSelect
              id={refreshId}
              size="sm"
              value={prefs.refreshMs}
              onChange={(event) =>
                setPrefs((current) => ({
                  ...current,
                  refreshMs: Number(event.target.value) as RefreshMs,
                }))
              }
            >
              {REFRESH_OPTIONS.map((option) => (
                <NativeSelectOption key={option} value={option}>
                  Every {option / 1000}s
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {arranging && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setPrefs(DEFAULT_PREFS);
                setPanOffset(0);
                setSelectedSampleAt(null);
                setFeedKind("all");
              }}
            >
              Reset layout
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setArranging((open) => !open)}>
            {arranging ? "Done" : "Edit layout"}
          </Button>
          <Button type="button" onClick={() => void loadDashboard()}>
            Refresh now
          </Button>
        </div>
      </div>

      {hiddenWidgets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs font-semibold text-muted-foreground">Hidden widgets</span>
          {hiddenWidgets.map((widget) => (
            <Button
              key={widget}
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setPrefs((current) => ({
                  ...current,
                  hidden: current.hidden.filter((entry) => entry !== widget),
                }))
              }
            >
              Add {widget}
            </Button>
          ))}
        </div>
      )}

      {/* Three across where the page's column has room for them (the widgets say how many
          of the twelve they take), one under the other where it has not. */}
      <div className="grid grid-cols-1 gap-6 @min-[961px]/console-page:grid-cols-12">
        {visibleWidgets.map((widget) => {
          if (widget === "services") {
            return (
              <DashboardWidget
                key={widget}
                title="Service status"
                description="Every dependency the server needs to answer."
                size={prefs.sizes[widget]}
                controls={controlsFor(widget)}
              >
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,150px),1fr))] gap-2.5">
                  <ServiceTile
                    label="Database"
                    value={health.database ? "Reachable" : "Down"}
                    bad={!health.database}
                    route={logsRoute}
                  />
                  <ServiceTile
                    label="Redis"
                    value={health.redis ? "Reachable" : "Down"}
                    bad={!health.redis}
                    route={logsRoute}
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
                        : logsHint("delivery failures and SMTP setup clues")
                    }
                    route={logsRoute}
                  />
                  <ServiceTile
                    label="Push"
                    value={health.push ? "On" : "No keys"}
                    bad={!health.push}
                    hint={
                      health.push ? undefined : "Closed-tab notifications are currently off."
                    }
                    route={logsRoute}
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
                        : logsHint("the most recent object storage failures")
                    }
                    route={logsRoute}
                  />
                  <ServiceTile label="Backups" {...backupTile(health.backup)} route={logsRoute} />
                </div>
                {/* A backup before an upgrade, say (M3 · B4). The server's administrators,
                    as the route is: a backup is the whole server's, not one workspace's. */}
                {isInstanceAdmin && health.backup?.enabled && (
                  <Button
                    type="button"
                    variant="outline"
                    className="self-start"
                    onClick={() =>
                      void api.admin
                        .backupNow()
                        .then(() =>
                          useToasts
                            .getState()
                            .push("info", "Backing up now. This page shows how it went."),
                        )
                        .catch(showError)
                    }
                  >
                    Back up now
                  </Button>
                )}
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
                controls={controlsFor(widget)}
              >
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,190px),1fr))] gap-2.5">
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
                        setFeedKind(metric.feedKind === "logs" && !isInstanceAdmin ? "all" : metric.feedKind);
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
                controls={controlsFor(widget)}
              >
                <div className="flex flex-col gap-3">
                  <div className="text-[length:clamp(1.4rem,3vw,2.4rem)] font-bold tabular-nums">
                    {activeMetric.format(health)}
                  </div>
                  <p className="m-0 text-sm leading-normal text-muted-foreground">
                    {activeMetric.description}
                  </p>
                  <p className="m-0 text-sm leading-normal text-muted-foreground">
                    {delta === null
                      ? "The dashboard is still collecting enough samples to calculate change."
                      : delta === 0
                        ? "This metric is flat across the last two samples."
                        : `Change over the latest sample: ${
                            delta > 0 ? "+" : ""
                          }${delta.toLocaleString()}.`}
                  </p>
                  <div className="flex flex-wrap gap-2.5">
                    <Button type="button" onClick={() => navigate(activeMetric.route)}>
                      Open detailed report
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        navigate(pathForRoute({ view: "server", section: "health" }))
                      }
                    >
                      Stay on dashboard
                    </Button>
                  </div>
                  {selectedSampleAt && (
                    <Alert role="status">
                      <AlertDescription>
                        Activity is filtered to entries after {sampleLabel({
                          at: selectedSampleAt,
                          health,
                        })}
                        . Clear that in the trend widget to return to the full feed.
                      </AlertDescription>
                    </Alert>
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
              controls={controlsFor(widget)}
            >
              <ActivityFeed
                items={feedItems}
                kind={feedKind}
                onKindChange={setFeedKind}
                withLogs={isInstanceAdmin}
              />
            </DashboardWidget>
          );
        })}
      </div>
      <BrowserErrors />
    </div>
  );
}
