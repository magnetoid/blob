/** The frame every dashboard panel sits in, and the controls on its corner.
 *
 * One frame rather than five, because the hide/resize/reorder controls have to behave
 * identically on each panel or the grid stops feeling like one thing.
 */

import { type WidgetId, type WidgetSize } from "./model.ts";

export function DashboardWidget({
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

export function WidgetControls({
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
