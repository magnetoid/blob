/** Who did what, and from where. */

import { useEffect, useRef, useState } from "react";
import { api, type AuditEvent } from "../../../lib/api.ts";
import { showError } from "../../../lib/toasts.ts";
import { formatRelative } from "../../messages/messageFormatting.ts";

/** The server's page size — a shorter page means the log has run out. */
const PAGE_SIZE = 50;

/** Turns `user.role_changed` into "Role changed". */
function humanizeAction(action: string): string {
  const [, verb] = action.split(".");
  const words = (verb ?? action).replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function AuditSection() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Bumped on every filter change so an older page still in flight for the
  // previous filter cannot append into the freshly reset list.
  const fetchSeq = useRef(0);

  useEffect(() => {
    const seq = ++fetchSeq.current;
    void api.admin
      .audit({ action: filter || undefined })
      .then((r) => {
        if (fetchSeq.current !== seq) return;
        setEvents(r.events);
        setHasMore(r.events.length === PAGE_SIZE);
      })
      .catch(() => {
        if (fetchSeq.current !== seq) return;
        setEvents([]);
        setHasMore(false);
      });
  }, [filter]);

  const loadOlder = () => {
    const oldest = events[events.length - 1];
    if (!oldest) return;
    const seq = fetchSeq.current;
    setLoadingOlder(true);
    void api.admin
      .audit({ action: filter || undefined, before: oldest.id })
      .then((r) => {
        if (fetchSeq.current !== seq) return;
        setEvents((prev) => [...prev, ...r.events]);
        setHasMore(r.events.length === PAGE_SIZE);
      })
      .catch(showError)
      .finally(() => setLoadingOlder(false));
  };

  const actions = [...new Set(events.map((e) => e.action))].sort();

  return (
    <section>
      <div className="chip-row" style={{ marginBottom: 18 }}>
        <button
          className="chip"
          aria-pressed={filter === ""}
          onClick={() => setFilter("")}
        >
          Everything
        </button>
        {actions.map((action) => (
          <button
            key={action}
            className="chip"
            aria-pressed={filter === action}
            onClick={() => setFilter(action)}
          >
            {humanizeAction(action)}
          </button>
        ))}
      </div>

      <div className="admin-table">
        {events.map((event) => (
          <div className="admin-row" key={event.id}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="admin-row-title">
                {humanizeAction(event.action)}
                {event.targetLabel && (
                  <span className="role-pill">{event.targetLabel}</span>
                )}
              </div>
              <div className="admin-row-meta">
                {event.actorName ?? "Someone"} ·{" "}
                {formatRelative(event.createdAt)}
                {event.ip && ` · ${event.ip}`}
                {Object.keys(event.metadata).length > 0 &&
                  ` · ${Object.entries(event.metadata)
                    .map(([k, v]) => `${k}: ${String(v)}`)
                    .join(", ")}`}
              </div>
            </div>
          </div>
        ))}
        {events.length === 0 && <p className="muted">Nothing recorded yet.</p>}
      </div>

      {hasMore && (
        <button
          className="btn btn-ghost"
          style={{ marginTop: 12 }}
          disabled={loadingOlder}
          onClick={loadOlder}
        >
          {loadingOlder ? "Loading…" : "Load older"}
        </button>
      )}
    </section>
  );
}
