/** Logs and audit events in one list, because they answer the same question.
 *
 * "What just happened" does not divide neatly into the two tables that store it, so the
 * feed merges them and the filter is there for when it does.
 */

import { cn } from "cn";
import { Badge } from "../../../../components/ui/badge.tsx";
import { ItemContent, ItemDescription, ItemTitle } from "../../../../components/ui/item.tsx";
import { ToggleGroup, ToggleGroupItem } from "../../../../components/ui/toggle-group.tsx";
import { CardNotice, CardRow, CardRows } from "../../../console/Card.tsx";
import { formatRelative } from "../../../messages/messageFormatting.ts";
import { type FeedItem, type FeedKind } from "./model.ts";

export function ActivityFeed({
  items,
  kind,
  onKindChange,
  withLogs = true,
}: {
  items: FeedItem[];
  kind: FeedKind;
  onKindChange: (kind: FeedKind) => void;
  /** The server's log is the server administrator's to read; for anyone else the feed
   *  is the workspace's audit trail, and a "Logs" filter would only ever be empty. */
  withLogs?: boolean;
}) {
  const options = [
    { label: "Everything", value: "all" as const },
    ...(withLogs ? [{ label: "Logs", value: "logs" as const }] : []),
    { label: "Audit", value: "audit" as const },
  ];
  return (
    <>
      {/* One kind at a time, and pressing the one that is chosen would leave none. */}
      <ToggleGroup
        aria-label="Show"
        variant="outline"
        size="sm"
        className="flex-wrap"
        value={[kind]}
        onValueChange={([next]) => {
          const chosen = options.find((option) => option.value === next);
          if (chosen) onKindChange(chosen.value);
        }}
      >
        {options.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {items.length === 0 ? (
        <CardNotice>No items match the current filters.</CardNotice>
      ) : (
        // The stripe down a row's edge is the level of a log: an error and a warning have to
        // be tellable apart without stopping to read.
        <CardRows aria-label="Recent activity">
          {items.map((item) => (
            <CardRow
              key={item.id}
              data-tone={item.tone}
              className={cn(
                "border-l-3 border-l-input pl-[calc(var(--card-spacing)-3px)]",
                item.tone === "warning" && "border-l-muted-foreground",
                item.tone === "danger" && "border-l-destructive",
              )}
            >
              <ItemContent>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant={item.kind === "audit" ? "outline" : "secondary"}>
                    {item.kind === "log" ? "Log" : "Audit"}
                  </Badge>
                  <span>{formatRelative(item.at)}</span>
                </div>
                <ItemTitle className="leading-snug wrap-anywhere">{item.title}</ItemTitle>
                {item.body && <ItemDescription className="wrap-anywhere">{item.body}</ItemDescription>}
              </ItemContent>
            </CardRow>
          ))}
        </CardRows>
      )}
    </>
  );
}
