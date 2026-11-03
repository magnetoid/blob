/** One table of what was spent (M2 · A9) — agents, people, or Blob's own features — on the
 * admin's Usage page and on an owner's own agents. Tokens are what was reported; a cost is
 * only as complete as the prices, and a row that is partly priced says so rather than
 * reading as less than it was.
 *
 * From `md` up it keeps its header row in view while the page scrolls past it, and that is
 * why it is not a `CardTable`. A sticky cell sticks to the nearest ancestor that scrolls, and
 * shadcn's `Table` draws its table in a box with `overflow-x: auto` so a wide one can scroll
 * sideways — which, overflow on one axis making a box a scroll container on both, would
 * hold the header to a box that never scrolls up or down. So this table is flush with the
 * card the same way, and from `md` takes that box's overflow off (`clip` is not a scroll
 * container); what it gives up there is the sideways scroll, so its cells wrap instead.
 *
 * Below `md` the box is left as it is. Four short columns fit most phones, but not every
 * name or a cost with "+ unpriced" on it at 320px or at 200% text, and a column that clips is
 * a column nobody can read; a scroll is the way to fail safe. The header is then not sticky,
 * which is how this table has always been on a phone. */

import { cn } from 'cn';
import type { UsageLine } from '../../lib/api.ts';
import { formatCost, formatCount } from '../../lib/format.ts';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.tsx';

/** A header cell that stays at the top of the page's scroll. Opaque, so rows go out of sight
 * under it rather than through it; its rule is a shadow, because a border would stay behind
 * with the row when the cell moves. */
const HEAD = 'sticky top-0 z-(--z-raised) bg-card shadow-[inset_0_-1px_0_var(--border)]';

export function UsageTable({
  label,
  lines,
  currency,
  heading,
  unit = 'Runs',
  nameOf = (line) => line.name,
  showOwner = true,
}: {
  /** The table's name, for a screen reader: the card's title says it to everyone else. */
  label: string;
  lines: UsageLine[];
  currency: string | null;
  /** What the first column names: "Agent", "Person". */
  heading: string;
  /** What `runs` counts on this table. */
  unit?: string;
  nameOf?: (line: UsageLine) => string;
  /** Off where every row is the reader's own. */
  showOwner?: boolean;
}) {
  return (
    <div className="-mx-(--card-spacing) md:**:data-[slot=table-container]:overflow-x-clip">
      <Table className="[&_tr>:first-child]:pl-(--card-spacing) [&_tr>:last-child]:pr-(--card-spacing)">
        <TableCaption className="sr-only">{label}</TableCaption>
        {/* The header's rule is the cells' own (above), so the row's would be a second one. */}
        <TableHeader className="[&_tr]:border-b-0">
          <TableRow>
            <TableHead scope="col" className={HEAD}>
              {heading}
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, 'text-right')}>
              {unit}
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, 'text-right')}>
              Tokens
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, 'text-right')}>
              Cost
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.id ?? line.name}>
              <TableCell className="whitespace-normal wrap-anywhere">
                <span className="font-medium">{nameOf(line)}</span>
                {showOwner && line.ownerName && (
                  <span className="ml-2 text-muted-foreground">{line.ownerName}’s</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{line.runs}</TableCell>
              <TableCell
                className="text-right tabular-nums"
                title={`${line.inputTokens.toLocaleString()} in · ${line.outputTokens.toLocaleString()} out`}
              >
                {line.tokens > 0 ? formatCount(line.tokens) : '—'}
              </TableCell>
              <TableCell className="text-right whitespace-normal tabular-nums">
                <Cost line={line} currency={currency} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Cost({ line, currency }: { line: UsageLine; currency: string | null }) {
  if (line.cost === null) {
    return line.tokens > 0 ? <span className="text-muted-foreground">no price</span> : <>—</>;
  }
  return (
    <>
      {formatCost(line.cost, currency)}
      {!line.costComplete && (
        <span className="text-muted-foreground" title="Some of these tokens have no price.">
          {' '}
          + unpriced
        </span>
      )}
    </>
  );
}
