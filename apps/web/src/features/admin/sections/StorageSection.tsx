/** Admin → Storage: what the workspace keeps in the bucket, by kind, and what the nightly
 * orphan sweep last did.
 *
 * Two honesties the page keeps. The sweep is the worker's and its record is in Redis, so
 * before the first run — or while Redis cannot be read — the page says "never run yet"
 * rather than drawing a zero as if a sweep had found nothing. And the probe is whether a
 * *browser* can reach the bucket, the same reading Health shows, because that is what an
 * upload needs and the server being able to reach it proves nothing.
 */

import { api, type AdminStorage } from "../../../lib/api.ts";
import { formatBytes } from "../../../lib/format.ts";
import type { ConsoleSectionProps } from "../../console/ConsoleShell.tsx";
import { Card, CardNotice } from "../../console/Card.tsx";
import { useAdminData } from "../../console/hooks.ts";

const KIND_NAMES: Record<string, string> = {
  file: "Files",
  voice: "Voice messages",
};

const PROBE_WORDS: Record<string, string> = {
  ok: "Reachable from a browser.",
  unconfigured: "Not configured: no public address to sign uploads against.",
  private:
    "A name only this server can resolve — a browser cannot upload to it.",
  unreachable: "Unreachable from a browser: uploads will fail.",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function KeptCard({ storage }: { storage: AdminStorage }) {
  return (
    <Card
      title="What is kept"
      description="Every file and voice recording sent here, and the room they take in the bucket."
    >
      <div className="console-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <th scope="col" className="num">
                Count
              </th>
              <th scope="col" className="num">
                Size
              </th>
            </tr>
          </thead>
          <tbody>
            {storage.byKind.map((row) => (
              <tr key={row.kind}>
                <th scope="row">{KIND_NAMES[row.kind] ?? row.kind}</th>
                <td className="num">{row.count.toLocaleString()}</td>
                <td className="num">{formatBytes(row.bytes)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td className="num">
                {storage.byKind
                  .reduce((sum, row) => sum + row.count, 0)
                  .toLocaleString()}
              </td>
              <td className="num">{formatBytes(storage.totalBytes)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="pref-hint m-0">
        {storage.orphans === 0
          ? "No upload is waiting to be swept."
          : `${count(storage.orphans, "upload", "uploads")} began and never reached a message; the sweep removes those older than a day.`}
      </p>
    </Card>
  );
}

function SweepCard({ sweep }: { sweep: AdminStorage["lastSweep"] }) {
  return (
    <Card
      title="Last sweep"
      description="Every night at 04:00 the worker removes uploads that never reached a message."
    >
      {sweep === null ? (
        <CardNotice>Never run yet.</CardNotice>
      ) : sweep.error ? (
        <p className="pref-hint m-0" data-testid="sweep-outcome">
          Failed {when(sweep.ranAt)}: {sweep.error}
        </p>
      ) : (
        <p className="pref-hint m-0" data-testid="sweep-outcome">
          Ran {when(sweep.ranAt)} and removed{" "}
          {sweep.removed === 0
            ? "nothing"
            : `${count(sweep.removed, "upload", "uploads")} (${formatBytes(sweep.bytes)})`}
          .
        </p>
      )}
    </Card>
  );
}

export function StorageSection({ onError }: ConsoleSectionProps) {
  const { data, loading } = useAdminData(
    () => api.admin.storage(),
    [],
    onError,
    "Could not load storage.",
  );

  return (
    <div className="console-stack">
      {!data && loading && (
        <Card title="What is kept">
          <CardNotice>Loading…</CardNotice>
        </Card>
      )}
      {data && <KeptCard storage={data} />}
      {data && <SweepCard sweep={data.lastSweep} />}
      {data && (
        <Card
          title="Bucket"
          description="Whether a browser can reach object storage, which is what an upload needs."
        >
          <p className="pref-hint m-0" data-ok={data.probe === "ok"}>
            {PROBE_WORDS[data.probe] ?? data.probe}
          </p>
        </Card>
      )}
    </div>
  );
}
