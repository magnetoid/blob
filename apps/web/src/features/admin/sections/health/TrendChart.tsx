/** The metric chart: pick a series, scroll back through it, pin a moment.
 *
 * Hand-drawn SVG rather than a charting library. It plots one series of at most 96
 * points and needs a click target per point, which is less code than configuring a
 * library to do the same and carries no dependency into the bundle.
 */

import { useCallback, useRef, useState } from "react";
import {
  METRICS,
  ZOOM_OPTIONS,
  metricByKey,
  type ChartZoom,
  type HealthMetricKey,
  type HealthSample,
} from "./model.ts";
import { chartWindow, sampleLabel } from "./series.ts";

export function TrendChart({
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
