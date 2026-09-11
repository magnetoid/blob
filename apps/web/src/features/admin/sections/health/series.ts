/** Turning the sample history into something a chart and a feed can show.

 * `chartWindow` is the only non-obvious one: the history grows without bound while the
 * chart shows a fixed count, and `offset` is how far back the person has scrolled, so
 * the window is clamped rather than allowed to run off either end.
 */

import { metricByKey, type ChartZoom, type FeedItem, type HealthMetricKey, type HealthSample } from "./model.ts";

export function normalizeLevel(level: string): FeedItem["tone"] {
  const lowered = level.toLowerCase();
  if (lowered === "error" || lowered === "critical") return "danger";
  if (lowered === "warning") return "warning";
  return "default";
}

export function sampleLabel(sample: HealthSample): string {
  return new Date(sample.at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function chartWindow(history: HealthSample[], zoom: ChartZoom, offset: number): HealthSample[] {
  if (history.length <= zoom) return history;
  const maxOffset = Math.max(0, history.length - zoom);
  const boundedOffset = Math.min(offset, maxOffset);
  const start = Math.max(0, history.length - zoom - boundedOffset);
  return history.slice(start, start + zoom);
}

export function deltaForMetric(metric: HealthMetricKey, history: HealthSample[]): number | null {
  if (history.length < 2) return null;
  const current = metricByKey(metric).raw(history[history.length - 1]!.health);
  const previous = metricByKey(metric).raw(history[history.length - 2]!.health);
  return current - previous;
}
