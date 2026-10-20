/** One table of what was spent (M2 · A9) — agents, people, or Blob's own features — on the
 * admin's Usage page and on an owner's own agents. Tokens are what was reported; a cost is
 * only as complete as the prices, and a row that is partly priced says so rather than
 * reading as less than it was. */

import type { UsageLine } from '../../lib/api.ts';
import { formatCost, formatCount } from '../../lib/format.ts';

export function UsageTable({
  lines,
  currency,
  heading,
  unit = 'Runs',
  nameOf = (line) => line.name,
  showOwner = true,
}: {
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
    <div className="console-table-wrap">
      <table className="admin-table usage-table">
        <thead>
          <tr>
            <th scope="col">{heading}</th>
            <th scope="col" className="num">
              {unit}
            </th>
            <th scope="col" className="num">
              Tokens
            </th>
            <th scope="col" className="num">
              Cost
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id ?? line.name}>
              <td>
                <span className="usage-name">{nameOf(line)}</span>
                {showOwner && line.ownerName && (
                  <span className="usage-owner">{line.ownerName}’s</span>
                )}
              </td>
              <td className="num">{line.runs}</td>
              <td
                className="num"
                title={`${line.inputTokens.toLocaleString()} in · ${line.outputTokens.toLocaleString()} out`}
              >
                {line.tokens > 0 ? formatCount(line.tokens) : '—'}
              </td>
              <td className="num">
                <Cost line={line} currency={currency} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cost({ line, currency }: { line: UsageLine; currency: string | null }) {
  if (line.cost === null) {
    return line.tokens > 0 ? <span className="usage-unpriced">no price</span> : <>—</>;
  }
  return (
    <>
      {formatCost(line.cost, currency)}
      {!line.costComplete && (
        <span className="usage-partial" title="Some of these tokens have no price.">
          {' '}
          + unpriced
        </span>
      )}
    </>
  );
}
