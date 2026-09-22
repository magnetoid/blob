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

import { useCallback, useState } from "react";
import { api, type ServerLogEntry } from "../../../lib/api.ts";
import { Card, CardNotice } from "../../console/Card.tsx";
import { useAdminAction, useAdminData } from '../../console/hooks.ts';
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { DialogPresence } from "../../../components/Dialog.tsx";

const LEVELS = [
  { label: "Everything", value: "" },
  { label: "Errors", value: "error" },
  { label: "Warnings", value: "warning" },
] as const;

export function LogsSection({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const [level, setLevel] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(
    () => api.admin.serverLogs({ level: level || undefined }),
    [level],
  );
  const { data, loading, reload } = useAdminData(
    load,
    [level],
    onError,
    "Could not read the log.",
  );
  const act = useAdminAction(onError, reload);

  const entries = data?.entries ?? [];

  return (
    <div className="console-stack">
      <Card
        description={
          <>
            The most recent {data?.capacity ?? 500} warnings and errors from every
            process on this server, newest first. Older ones fall off the end — this
            is a buffer for noticing something, not a record to keep.
          </>
        }
      >
        <div className="console-toolbar">
          <div className="chip-row">
            {LEVELS.map((option) => (
              <button
                key={option.value}
                className="chip"
                aria-pressed={level === option.value}
                onClick={() => setLevel(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost" onClick={reload}>
            Refresh
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => setClearing(true)}
            disabled={entries.length === 0}
          >
            Clear
          </button>
        </div>

        {/* No data and no request in flight means the load failed: the error above says
            so, and "Nothing has gone wrong recently" under it would contradict it. */}
        {data === null ? (
          loading && <CardNotice>Loading…</CardNotice>
        ) : entries.length === 0 ? (
          <CardNotice>
            Nothing has gone wrong recently. {level && "Try widening the filter."}
          </CardNotice>
        ) : (
          <div className="console-list">
            {entries.map((entry: ServerLogEntry, index: number) => {
              // The buffer has no ids — it is a Redis list, and two identical records a
              // millisecond apart are genuinely indistinguishable. Position is the identity.
              const key = `${entry.at}-${index}`;
              const open = expanded === key;
              return (
                <div
                  key={key}
                  className="console-list-item log-entry"
                  data-level={entry.level.toLowerCase()}
                >
                  <div className="log-head">
                    <span className="log-level">{entry.level}</span>
                    <time className="log-at" dateTime={entry.at}>
                      {new Date(entry.at).toLocaleString()}
                    </time>
                    <span className="log-logger">{entry.logger}</span>
                    {entry.path && (
                      <span className="log-route">
                        {entry.method} {entry.path}
                      </span>
                    )}
                  </div>

                  <div className="log-message">{entry.message}</div>

                  {entry.detail && (
                    <>
                      <button
                        className="btn btn-ghost log-toggle"
                        onClick={() => setExpanded(open ? null : key)}
                        aria-expanded={open}
                      >
                        {open ? "Hide traceback" : "Show traceback"}
                      </button>
                      {open && <pre className="log-detail">{entry.detail}</pre>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
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
