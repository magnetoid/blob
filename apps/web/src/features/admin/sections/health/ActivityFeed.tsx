/** Logs and audit events in one list, because they answer the same question.
 *
 * "What just happened" does not divide neatly into the two tables that store it, so the
 * feed merges them and the filter is there for when it does.
 */

import { formatRelative } from "../../../messages/messageFormatting.ts";
import { type FeedItem, type FeedKind } from "./model.ts";

export function ActivityFeed({
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
