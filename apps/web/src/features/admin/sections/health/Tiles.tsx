/** The two smallest readings: one service, and one number with its trend.
 *
 * Both are buttons rather than text. Every figure on this page is a question someone is
 * about to follow up on, so each one navigates to the page that explains it.
 */

import { type AdminHealth } from "../../../../lib/api.ts";
import { navigate } from "../../../../lib/router.ts";
import { METRICS } from "./model.ts";

export function ServiceTile({
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

export function MetricCard({
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
