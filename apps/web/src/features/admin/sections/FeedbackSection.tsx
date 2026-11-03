/** Tickets filed from the user menu, with what the browser attached to them.
 *
 * The snapshot is rendered in a sandboxed iframe. It is markup captured from someone
 * else's browser, so it is treated as hostile: the server serves it under a restrictive
 * CSP, and the sandbox attribute here allows nothing — no scripts, no forms, no
 * same-origin access.
 */

import { useEffect, useId, useState } from "react";
import type { FeedbackTicket } from "@blob/shared";
import { api } from "../../../lib/api.ts";
import { useStore } from "../../../lib/store.ts";
import { Badge } from "../../../components/ui/badge.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { ItemActions, ItemContent, ItemDescription, ItemTitle } from "../../../components/ui/item.tsx";
import { ToggleGroup, ToggleGroupItem } from "../../../components/ui/toggle-group.tsx";
import { formatRelative } from "../../messages/messageFormatting.ts";
import { Card, CardNotice, CardRow, CardRows } from "../../console/Card.tsx";

type Filter = "open" | "closed" | "all";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

/** A bug is the one kind that is urgent; a feature request is the one that is wanted. */
const KIND_BADGE = { bug: "destructive", feature: "secondary", feedback: "outline" } as const;

export function FeedbackSection({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const users = useStore((s) => s.users);
  const [tickets, setTickets] = useState<FeedbackTicket[]>([]);
  const [filter, setFilter] = useState<Filter>("open");
  const [openId, setOpenId] = useState<string | null>(null);
  const [showing, setShowing] = useState<"log" | "snapshot" | null>(null);
  const [loading, setLoading] = useState(true);
  const detailId = useId();

  useEffect(() => {
    // A filter switched while a slower request is still in flight would otherwise let
    // the stale response win and show the wrong list.
    let current = true;
    api.feedback
      .list(filter === "all" ? undefined : filter)
      .then((response) => {
        if (current) setTickets(response.tickets);
      })
      .catch(() => {
        if (current) onError("Could not load feedback.");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [filter, onError]);

  async function setStatus(ticket: FeedbackTicket, status: "open" | "closed") {
    try {
      const { ticket: updated } = await api.feedback.setStatus(
        ticket.id,
        status,
      );
      setTickets((current) =>
        filter === "all"
          ? current.map((item) => (item.id === updated.id ? updated : item))
          : current.filter((item) => item.id !== updated.id),
      );
    } catch {
      onError("Could not update that ticket.");
    }
  }

  async function remove(ticket: FeedbackTicket) {
    try {
      await api.feedback.remove(ticket.id);
      setTickets((current) => current.filter((item) => item.id !== ticket.id));
      setOpenId(null);
    } catch {
      onError("Could not delete that ticket.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <ToggleGroup
          aria-label="Show"
          variant="outline"
          spacing={0}
          value={[filter]}
          // Pressing the one that is chosen would leave no filter at all.
          onValueChange={([next]) => {
            const chosen = FILTERS.find((f) => f.value === next);
            if (!chosen) return;
            setOpenId(null);
            setLoading(true);
            setFilter(chosen.value);
          }}
        >
          {FILTERS.map((f) => (
            <ToggleGroupItem key={f.value} value={f.value}>
              {f.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {loading && <CardNotice>Loading…</CardNotice>}
        {!loading && tickets.length === 0 && (
          <CardNotice>
            {filter === "open" ? "Nothing open. " : "Nothing here. "}
            Anyone can file a ticket from the user menu.
          </CardNotice>
        )}

        {tickets.length > 0 && (
          <CardRows>
            {tickets.map((ticket) => {
              const expanded = openId === ticket.id;
              const reporter = ticket.reporterId
                ? users[ticket.reporterId]
                : undefined;
              const titleId = `${detailId}-${ticket.id}-title`;
              const panelId = `${detailId}-${ticket.id}`;

              return (
                <CardRow key={ticket.id}>
                  <Badge variant={KIND_BADGE[ticket.kind]} className="capitalize">
                    {ticket.kind}
                  </Badge>
                  <ItemContent>
                    <ItemTitle id={titleId}>{ticket.title}</ItemTitle>
                    <ItemDescription>
                      {reporter?.displayName ?? "Someone who has since left"} ·{" "}
                      {formatRelative(ticket.createdAt)}
                      {ticket.status === "closed" && " · closed"}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    {/* One word for the state it is in, kept: `aria-expanded` says whether
                        it is open. Named by the ticket as well, as every row has one. */}
                    <Button
                      id={`${panelId}-toggle`}
                      variant="outline"
                      aria-expanded={expanded}
                      aria-controls={expanded ? panelId : undefined}
                      aria-labelledby={`${panelId}-toggle ${titleId}`}
                      onClick={() => {
                        setShowing(null);
                        setOpenId(expanded ? null : ticket.id);
                      }}
                    >
                      Details
                    </Button>
                  </ItemActions>

                  {expanded && (
                    <div
                      id={panelId}
                      className="flex basis-full flex-col gap-3.5 rounded-lg border bg-muted/50 p-4"
                    >
                      {ticket.body && <p className="text-sm whitespace-pre-wrap">{ticket.body}</p>}

                      {Object.keys(ticket.environment).length > 0 && (
                        <dl className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-4 gap-y-2">
                          {Object.entries(ticket.environment).map(([key, value]) => (
                            <div key={key}>
                              <dt className="text-xs text-muted-foreground">{key}</dt>
                              <dd className="text-sm wrap-anywhere">{value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        {/* Showing the log, the snapshot or neither: a choice of one that
                            may be none, so pressing the one that is shown puts it away. */}
                        {(ticket.consoleLog || ticket.hasSnapshot) && (
                          <ToggleGroup
                            aria-label="Attached"
                            variant="outline"
                            size="sm"
                            value={showing ? [showing] : []}
                            onValueChange={([next]) =>
                              setShowing(next === "log" || next === "snapshot" ? next : null)
                            }
                          >
                            {ticket.consoleLog && (
                              <ToggleGroupItem value="log">Console log</ToggleGroupItem>
                            )}
                            {ticket.hasSnapshot && (
                              <ToggleGroupItem value="snapshot">Page snapshot</ToggleGroupItem>
                            )}
                          </ToggleGroup>
                        )}
                        <div className="ml-auto flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            onClick={() =>
                              void setStatus(
                                ticket,
                                ticket.status === "open" ? "closed" : "open",
                              )
                            }
                          >
                            {ticket.status === "open" ? "Close" : "Reopen"}
                          </Button>
                          <Button
                            variant="destructive"
                            aria-label={`Delete "${ticket.title}"`}
                            onClick={() => void remove(ticket)}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>

                      {showing === "log" && (
                        <pre className="max-h-80 overflow-auto rounded-lg border bg-background p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                          {ticket.consoleLog}
                        </pre>
                      )}

                      {showing === "snapshot" && (
                        <iframe
                          className="h-[460px] w-full rounded-lg border bg-background"
                          title={`Page snapshot for ${ticket.title}`}
                          src={api.feedback.snapshotUrl(ticket.id)}
                          sandbox=""
                        />
                      )}
                    </div>
                  )}
                </CardRow>
              );
            })}
          </CardRows>
        )}
      </Card>
    </div>
  );
}
