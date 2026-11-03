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
 *
 * Each bar is a column to press with the bar drawn in it — see `COLUMN` and `BAR`.
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

/**
 * One point of the series: a column to press, and the bar drawn inside it.
 *
 * The button is the target and is the plot's full height whatever its value, so a low bar
 * is as easy to press as a high one — a bar that is a hundredth of the largest, scaled down
 * with the button it was, was a few pixels high to hit — and its focus ring and pinned
 * outline are drawn on a box that is not scaled. It carries no colour of its own.
 *
 * The bar is its child, scaled from the bottom by its share of the window's largest. That
 * is data, so it rides in a custom property. It is decoration (`aria-hidden`): the button is
 * what has a name. It reads the column's state — hover, focus, pinned — through `group-*`,
 * and the colours are the chart palette's, one end of it in light and the other in dark.
 * Tailwind's `scale-y-*` sets the `scale` property, so that is what transitions.
 *
 * The column's width is what the plot has left over, shared by up to 96 points, so it can be
 * a few pixels on a phone, and a column that narrow is not 44px wide under a finger. That is
 * the exception to the touch size: it cannot be met by 96 columns in a phone's width. The
 * height can be, and is — the plot is 220px. The space between bars is a margin on the bar
 * (`w-4/5`), so it shrinks with the column; a `gap` could not, and 96 of them pushed the
 * newest samples out of a box that clips.
 */
const COLUMN = [
  "group flex min-w-0 flex-1 basis-0 items-stretch justify-center self-stretch rounded-sm",
  // The ring is the focus. No bare `outline-none`: it sets `--tw-outline-style: none`, which
  // `outline-2` below reads, and the pinned outline would never be drawn.
  "hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
  // The pinned moment: an outline round the column, so it is not told by colour alone.
  "aria-pressed:bg-foreground/5 aria-pressed:outline-2 aria-pressed:outline-ring",
].join(" ");

const BAR = [
  "w-4/5 min-w-px self-stretch origin-bottom scale-y-(--bar-scale) rounded-t-sm",
  "bg-chart-2 group-hover:bg-chart-4 group-focus-visible:bg-chart-4",
  "dark:group-hover:bg-chart-1 dark:group-focus-visible:bg-chart-1",
  "group-aria-pressed:bg-chart-5 dark:group-aria-pressed:bg-chart-1",
  "transition-[scale,background-color] duration-(--dur-micro) ease-(--ease-standard) motion-reduce:transition-none",
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
        className="flex min-h-55 touch-pan-y items-end overflow-hidden rounded-lg border bg-muted/50 p-3"
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
                className={COLUMN}
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
              >
                <span
                  aria-hidden="true"
                  className={BAR}
                  style={{ "--bar-scale": scale } as CSSProperties}
                />
              </button>
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
