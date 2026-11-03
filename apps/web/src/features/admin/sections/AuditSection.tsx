/** Who did what, and from where. */

import { useEffect, useRef, useState } from "react";
import { api, type AuditEvent } from "../../../lib/api.ts";
import { showError } from "../../../lib/toasts.ts";
import { Badge } from "../../../components/ui/badge.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { ItemContent, ItemDescription, ItemTitle } from "../../../components/ui/item.tsx";
import { ToggleGroup, ToggleGroupItem } from "../../../components/ui/toggle-group.tsx";
import { formatRelative } from "../../messages/messageFormatting.ts";
import { Card, CardNotice, CardRow, CardRows } from "../../console/Card.tsx";

/** The server's page size — a shorter page means the log has run out. */
const PAGE_SIZE = 50;

/** What "Everything" is called to the toggle group, which has no empty value. */
const ALL = "all";

/** Actions whose verb alone would not say what happened. */
const LABELS: Record<string, string> = {
  "retention.updated": "Retention changed",
  "retention.swept": "Retention sweep",
  "legal_hold.placed": "Legal hold placed",
  "legal_hold.released": "Legal hold released",
};

/** Turns `user.role_changed` into "Role changed". */
function humanizeAction(action: string): string {
  if (LABELS[action]) return LABELS[action];
  const [, verb] = action.split(".");
  const words = (verb ?? action).replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function AuditSection() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // False until the first page has answered, so the card says it is loading rather
  // than "Nothing recorded yet" about a log it has not read.
  const [loaded, setLoaded] = useState(false);
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
      })
      .finally(() => {
        if (fetchSeq.current === seq) setLoaded(true);
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
    <div className="flex flex-col gap-6">
      <Card
        footer={
          hasMore ? (
            // Busy, not gone: a button disabled under the pointer would drop focus to the
            // page while the older events load.
            <Button
              variant="outline"
              disabled={loadingOlder}
              focusableWhenDisabled
              onClick={loadOlder}
            >
              {loadingOlder ? "Loading…" : "Load older"}
            </Button>
          ) : undefined
        }
      >
        {/* One kind of action at a time, and pressing the one that is chosen would leave
            none: "Everything" is how to ask for no filter. */}
        <ToggleGroup
          aria-label="Show"
          variant="outline"
          size="sm"
          className="flex-wrap"
          value={[filter === "" ? ALL : filter]}
          onValueChange={([next]) => {
            if (next === undefined) return;
            setFilter(next === ALL ? "" : next);
          }}
        >
          <ToggleGroupItem value={ALL}>Everything</ToggleGroupItem>
          {actions.map((action) => (
            <ToggleGroupItem key={action} value={action}>
              {humanizeAction(action)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {!loaded ? (
          <CardNotice>Loading…</CardNotice>
        ) : events.length === 0 ? (
          <CardNotice>Nothing recorded yet.</CardNotice>
        ) : (
          <CardRows aria-label="Audit log">
            {events.map((event) => (
              <CardRow key={event.id}>
                <ItemContent>
                  <ItemTitle>
                    {humanizeAction(event.action)}
                    {event.targetLabel && <Badge variant="outline">{event.targetLabel}</Badge>}
                  </ItemTitle>
                  {/* An address and the metadata are data, and may be one unbroken token. */}
                  <ItemDescription className="wrap-anywhere">
                    {/* No actor is Blob itself — the nightly retention sweep (ADR 0039). */}
                    {event.actorName ?? (event.actorId ? "Someone" : "Blob")} ·{" "}
                    {formatRelative(event.createdAt)}
                    {event.ip && ` · ${event.ip}`}
                    {Object.keys(event.metadata).length > 0 &&
                      ` · ${Object.entries(event.metadata)
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join(", ")}`}
                  </ItemDescription>
                </ItemContent>
              </CardRow>
            ))}
          </CardRows>
        )}
      </Card>
    </div>
  );
}
