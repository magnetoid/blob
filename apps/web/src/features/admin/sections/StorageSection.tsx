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
import {
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table.tsx";
import type { ConsoleSectionProps } from "../../console/ConsoleShell.tsx";
import { Card, CardNotice, CardTable } from "../../console/Card.tsx";
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
      <CardTable label="What is kept">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Kind</TableHead>
            <TableHead scope="col" className="text-right">
              Count
            </TableHead>
            <TableHead scope="col" className="text-right">
              Size
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {storage.byKind.map((row) => (
            <TableRow key={row.kind}>
              <TableHead scope="row" className="h-auto p-2 font-normal">
                {KIND_NAMES[row.kind] ?? row.kind}
              </TableHead>
              <TableCell className="text-right tabular-nums">{row.count.toLocaleString()}</TableCell>
              <TableCell className="text-right tabular-nums">{formatBytes(row.bytes)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableHead scope="row" className="h-auto p-2">
              Total
            </TableHead>
            <TableCell className="text-right tabular-nums">
              {storage.byKind.reduce((sum, row) => sum + row.count, 0).toLocaleString()}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatBytes(storage.totalBytes)}</TableCell>
          </TableRow>
        </TableFooter>
      </CardTable>
      <p className="m-0 text-sm text-pretty text-muted-foreground">
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
        <p className="m-0 text-sm text-pretty wrap-anywhere text-muted-foreground" data-testid="sweep-outcome">
          Failed {when(sweep.ranAt)}: {sweep.error}
        </p>
      ) : (
        <p className="m-0 text-sm text-pretty wrap-anywhere text-muted-foreground" data-testid="sweep-outcome">
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
    <div className="flex flex-col gap-6">
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
          <p className="m-0 text-sm text-pretty text-muted-foreground" data-ok={data.probe === "ok"}>
            {PROBE_WORDS[data.probe] ?? data.probe}
          </p>
        </Card>
      )}
    </div>
  );
}
