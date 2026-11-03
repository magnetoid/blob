/** What has gone wrong on this server recently.
 *
 * Health says whether the parts answer and the audit log says who did what. Neither
 * says what *failed*, so the only account of a problem was the container's stdout —
 * behind shell access to the host, gone after a restart, and split across processes on
 * a box running more than one. `lib/logbuf` copies warnings and errors into a capped
 * Redis list; this reads it.
 *
 * A buffer, not an archive, and the page says so: the count is capped and the oldest
 * records fall off the end. Anything more is a log shipper, which this is deliberately
 * not trying to be.
 */

import { useCallback, useId, useState } from "react";
import { cn } from "cn";
import { api, type ServerLogEntry } from "../../../lib/api.ts";
import { Badge } from "../../../components/ui/badge.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { ItemContent } from "../../../components/ui/item.tsx";
import { ToggleGroup, ToggleGroupItem } from "../../../components/ui/toggle-group.tsx";
import { Card, CardNotice, CardRow, CardRows } from "../../console/Card.tsx";
import { useAdminAction, useAdminData } from '../../console/hooks.ts';
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { DialogPresence } from "../../../components/Dialog.tsx";

/** `value` is what the server is asked for; "Everything" asks for no level at all. */
const LEVELS = [
  { key: "all", label: "Everything", value: "" },
  { key: "error", label: "Errors", value: "error" },
  { key: "warning", label: "Warnings", value: "warning" },
] as const;

type LevelKey = (typeof LEVELS)[number]["key"];

export function LogsSection({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const [level, setLevel] = useState<LevelKey>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const levelValue = LEVELS.find((option) => option.key === level)?.value ?? "";

  const load = useCallback(
    () => api.admin.serverLogs({ level: levelValue || undefined }),
    [levelValue],
  );
  const { data, loading, reload } = useAdminData(
    load,
    [levelValue],
    onError,
    "Could not read the log.",
  );
  const act = useAdminAction(onError, reload);

  const entries = data?.entries ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Card
        description={
          <>
            The most recent {data?.capacity ?? 500} warnings and errors from every
            process on this server, newest first. Older ones fall off the end — this
            is a buffer for noticing something, not a record to keep.
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          {/* One level at a time, and pressing the one that is chosen would leave none. */}
          <ToggleGroup
            aria-label="Show"
            variant="outline"
            spacing={0}
            value={[level]}
            onValueChange={([next]) => {
              const chosen = LEVELS.find((option) => option.key === next);
              if (chosen) setLevel(chosen.key);
            }}
          >
            {LEVELS.map((option) => (
              <ToggleGroupItem key={option.key} value={option.key}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={reload}>
              Refresh
            </Button>
            {/* Nothing to clear is not busy, but it is the same trap: the button that was
                pressed to clear the log is the one that goes inert when the log is empty, and
                focus is handed back to it. */}
            <Button
              variant="outline"
              onClick={() => setClearing(true)}
              disabled={entries.length === 0}
              focusableWhenDisabled
            >
              Clear
            </Button>
          </div>
        </div>

        {/* No data and no request in flight means the load failed: the error above says
            so, and "Nothing has gone wrong recently" under it would contradict it. */}
        {data === null ? (
          loading && <CardNotice>Loading…</CardNotice>
        ) : entries.length === 0 ? (
          <CardNotice>
            Nothing has gone wrong recently. {level !== "all" && "Try widening the filter."}
          </CardNotice>
        ) : (
          <CardRows aria-label="Recent warnings and errors">
            {entries.map((entry: ServerLogEntry, index: number) => {
              // The buffer has no ids — it is a Redis list, and two identical records a
              // millisecond apart are genuinely indistinguishable. Position is the identity.
              const key = `${entry.at}-${index}`;
              return (
                <LogRow
                  key={key}
                  entry={entry}
                  open={expanded === key}
                  onToggle={() => setExpanded(expanded === key ? null : key)}
                />
              );
            })}
          </CardRows>
        )}
      </Card>

      <DialogPresence when={clearing}>
        {() => (
          <ConfirmDialog
            title="Clear the log?"
            body="These are the only copy this console has. Anything still in the container's own output is unaffected."
            confirmLabel="Clear"
            danger
            onClose={() => setClearing(false)}
            onConfirm={() => {
              setClearing(false);
              void act(async () => {
                await api.admin.clearServerLogs();
              });
            }}
          />
        )}
      </DialogPresence>
    </div>
  );
}

/**
 * One record. The level is the thing being scanned for, so it is a stripe down the row's
 * edge as well as a word: an error and a warning have to be tellable apart without stopping.
 */
function LogRow({
  entry,
  open,
  onToggle,
}: {
  entry: ServerLogEntry;
  open: boolean;
  onToggle: () => void;
}) {
  const ids = useId();
  const level = entry.level.toLowerCase();
  const isError = level === "error" || level === "critical";
  return (
    <CardRow
      data-level={level}
      className={cn(
        "border-l-3 border-l-input pl-[calc(var(--card-spacing)-3px)]",
        level === "warning" && "border-l-muted-foreground",
        isError && "border-l-destructive",
      )}
    >
      <ItemContent>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
          <Badge variant={isError ? "destructive" : "outline"}>{entry.level}</Badge>
          <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
          <span className="font-mono wrap-anywhere">{entry.logger}</span>
          {entry.path && (
            <span className="font-mono wrap-anywhere">
              {entry.method} {entry.path}
            </span>
          )}
        </div>

        <p id={`${ids}-message`} className="m-0 text-sm leading-normal wrap-anywhere">
          {entry.message}
        </p>

        {entry.detail && (
          <>
            {/* Named by the record it opens: every entry with a traceback has this button. */}
            <Button
              id={`${ids}-toggle`}
              variant="ghost"
              size="sm"
              className="-ml-2.5 self-start"
              aria-expanded={open}
              aria-controls={open ? `${ids}-detail` : undefined}
              aria-labelledby={`${ids}-toggle ${ids}-message`}
              onClick={onToggle}
            >
              Traceback
            </Button>
            {/* A traceback is wide and tall: it scrolls inside its own box, in monospace,
                rather than stretching the console. The page body must never scroll sideways. */}
            {open && (
              <pre
                id={`${ids}-detail`}
                className="m-0 max-h-80 overflow-auto rounded-md bg-muted p-2.5 font-mono text-xs leading-normal whitespace-pre text-muted-foreground"
              >
                {entry.detail}
              </pre>
            )}
          </>
        )}
      </ItemContent>
    </CardRow>
  );
}
