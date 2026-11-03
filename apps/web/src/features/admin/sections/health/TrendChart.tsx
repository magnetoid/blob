/** The metric chart: pick a series, scroll back through it, pin a moment.
 *
 * Hand-drawn rather than a charting library. It plots one series of at most 96
 * points and needs a click target per point, which is less code than configuring a
 * library to do the same and carries no dependency into the bundle. The bars are buttons,
 * which is what makes each point a target with a name and a place in the tab order.
 *
 * Coloured from the chart palette (`--chart-1` … `--chart-5`), the theme's own: the middle
 * of it reads on the plot in light and in dark, and a bar that is hovered or chosen moves
 * toward the end of the scale that contrasts with the plot in that scheme.
 */

import { useCallback, useId, useRef, useState, type CSSProperties } from "react";
import { Button } from "../../../../components/ui/button.tsx";
import { Label } from "../../../../components/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "../../../../components/ui/native-select.tsx";
import { ToggleGroup, ToggleGroupItem } from "../../../../components/ui/toggle-group.tsx";
import {
  METRICS,
  ZOOM_OPTIONS,
  metricByKey,
  type ChartZoom,
  type HealthMetricKey,
  type HealthSample,
} from "./model.ts";
import { chartWindow, sampleLabel } from "./series.ts";

/** One bar. Its height is its value's share of the window's largest, so it is data and rides
 * in a custom property; it is stretched to the plot's full height and scaled down from the
 * bottom. The bar needs a real size from layout (`self-stretch`, `flex-1`), which happy-dom
 * does not have, so the tests pin the classes. */
const BAR = [
  "min-w-3.5 flex-1 basis-0 origin-bottom self-stretch scale-y-(--bar-scale) rounded-t-sm outline-none",
  "bg-chart-2 hover:bg-chart-4 focus-visible:bg-chart-4 dark:hover:bg-chart-1 dark:focus-visible:bg-chart-1",
  "focus-visible:ring-3 focus-visible:ring-ring/50",
  // The pinned moment: the far end of the scale, and an outline round it so it is not
  // told by colour alone.
  "aria-pressed:bg-chart-5 aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-ring dark:aria-pressed:bg-chart-1",
  "transition-[transform,background-color] duration-(--dur-micro) ease-(--ease-standard) motion-reduce:transition-none",
].join(" ");

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
  const windowId = useId();

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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {/* One series at a time, and pressing the one that is chosen would leave none. */}
        <ToggleGroup
          aria-label="Metric"
          variant="outline"
          size="sm"
          className="flex-wrap"
          value={[metric]}
          onValueChange={([next]) => {
            const chosen = METRICS.find((entry) => entry.key === next);
            if (chosen) onSelectMetric(chosen.key);
          }}
        >
          {METRICS.map((entry) => (
            <ToggleGroupItem key={entry.key} value={entry.key}>
              {entry.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={windowId} className="text-muted-foreground">
            Window
          </Label>
          <NativeSelect
            id={windowId}
            size="sm"
            value={zoom}
            onChange={(event) => onZoom(Number(event.target.value) as ChartZoom)}
          >
            {ZOOM_OPTIONS.map((option) => (
              <NativeSelectOption key={option} value={option}>
                {option} points
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => moveWindow(-1)}
            disabled={history.length <= zoom}
          >
            Older
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => moveWindow(1)}
            disabled={history.length <= zoom}
          >
            Newer
          </Button>
        </div>
      </div>

      <div className="min-h-5.5 text-sm text-pretty text-muted-foreground" aria-live="polite">
        {currentSample ? (
          <>
            <strong className="font-semibold text-foreground">{metricDef.label}</strong> was{" "}
            {metricDef.format(currentSample.health)} at{" "}
            {sampleLabel(currentSample)}.
            {selectedSampleAt === currentSample.at &&
              " Activity is currently filtered to items after this point."}
          </>
        ) : (
          "Waiting for enough live data to draw a chart."
        )}
      </div>

      <div
        data-slot="trend-plot"
        className="flex min-h-55 touch-pan-y items-end gap-1.5 overflow-hidden rounded-lg border bg-muted/50 p-3"
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
          <div className="grid w-full place-items-center text-sm text-muted-foreground">
            Waiting for the first live sample…
          </div>
        ) : (
          visible.map((sample) => {
            const value = metricDef.raw(sample.health);
            const scale = Math.max(0.08, value / max);
            const active = selectedSampleAt === sample.at;
            return (
              <button
                key={sample.at}
                type="button"
                className={BAR}
                style={{ "--bar-scale": scale } as CSSProperties}
                aria-pressed={active}
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
                onClick={() => onSelectSample(active ? null : sample.at)}
              />
            );
          })
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2.5 text-xs text-muted-foreground">
        <span>Swipe left or right on touch screens to pan the chart.</span>
        {selectedSampleAt && (
          <Button variant="ghost" size="sm" onClick={() => onSelectSample(null)}>
            Clear chart filter
          </Button>
        )}
      </div>
    </div>
  );
}
