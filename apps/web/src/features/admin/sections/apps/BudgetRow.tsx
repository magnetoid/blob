/** The meter and the dial on one line: what the trailing day cost, against the caps.
 *
 * Runs begun and wall-clock time occupied are what Blob observes itself. Tokens are the
 * agent's own count, reported on its runs' last events (AG-UI 1.0), and since M2 · A9 they
 * can be capped too — on that count, so an agent that reports none is never stopped by
 * it, and the field says so. Admins think in
 * minutes, the server stores seconds; the conversion lives here and nowhere else. The
 * component is keyed by its callers on the saved caps, so a save that comes back from
 * the reload reseeds the inputs instead of fighting them.
 *
 * Its own file since the Janus page: that page spends the same budget on the same
 * routes, and a second copy of the minutes/seconds conversion is the copy that drifts.
 */

import { useId, useState } from "react";
import { api, type AdminPlugin } from "../../../../lib/api.ts";
import { formatTokens } from "../../../../lib/format.ts";
import { Button } from "../../../../components/ui/button.tsx";
import { FieldDescription, FieldLabel } from "../../../../components/ui/field.tsx";
import { Input } from "../../../../components/ui/input.tsx";

export function BudgetRow({
  plugin,
  act,
}: {
  plugin: AdminPlugin;
  act: (run: () => Promise<unknown>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [runs, setRuns] = useState(
    plugin.budgetRunsPerDay !== null ? String(plugin.budgetRunsPerDay) : "",
  );
  const [minutes, setMinutes] = useState(
    plugin.budgetSecondsPerDay !== null
      ? String(Math.round(plugin.budgetSecondsPerDay / 60))
      : "",
  );
  const [tokens, setTokens] = useState(
    plugin.budgetTokensPerDay !== null ? String(plugin.budgetTokensPerDay) : "",
  );
  const fields = useId();

  const usedMinutes = Math.round(plugin.secondsLastDay / 60);
  const capped =
    plugin.budgetRunsPerDay !== null ||
    plugin.budgetSecondsPerDay !== null ||
    plugin.budgetTokensPerDay !== null;
  const used =
    `${plugin.runsLastDay} run${plugin.runsLastDay === 1 ? "" : "s"}` +
    (plugin.budgetRunsPerDay !== null ? ` of ${plugin.budgetRunsPerDay}` : "") +
    ` · ${usedMinutes}m` +
    (plugin.budgetSecondsPerDay !== null
      ? ` of ${Math.round(plugin.budgetSecondsPerDay / 60)}m`
      : "") +
    (plugin.budgetTokensPerDay !== null
      ? ` · ${formatTokens(plugin.tokensLastDay)} of ${formatTokens(plugin.budgetTokensPerDay)}`
      : plugin.tokensLastDay > 0
        ? ` · ${formatTokens(plugin.tokensLastDay)}`
        : "");
  const over =
    (plugin.budgetRunsPerDay !== null &&
      plugin.runsLastDay >= plugin.budgetRunsPerDay) ||
    (plugin.budgetSecondsPerDay !== null &&
      plugin.secondsLastDay >= plugin.budgetSecondsPerDay) ||
    (plugin.budgetTokensPerDay !== null &&
      plugin.tokensLastDay >= plugin.budgetTokensPerDay);

  const save = () => {
    const runsNum = runs.trim() === "" ? null : Number(runs);
    const minutesNum = minutes.trim() === "" ? null : Number(minutes);
    const tokensNum = tokens.trim() === "" ? null : Number(tokens);
    if (runsNum !== null && (!Number.isInteger(runsNum) || runsNum < 1)) return;
    if (minutesNum !== null && (!Number.isInteger(minutesNum) || minutesNum < 1))
      return;
    if (tokensNum !== null && (!Number.isInteger(tokensNum) || tokensNum < 1)) return;
    void act(() =>
      api.admin.setPluginBudget(plugin.id, {
        runsPerDay: runsNum,
        secondsPerDay: minutesNum !== null ? minutesNum * 60 : null,
        tokensPerDay: tokensNum,
      }),
    ).then(() => setEditing(false));
  };

  if (editing) {
    return (
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`${fields}-runs`}>Runs / day</FieldLabel>
          <Input
            id={`${fields}-runs`}
            className="w-24"
            type="number"
            min={1}
            placeholder="∞"
            value={runs}
            onChange={(e) => setRuns(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`${fields}-minutes`}>Minutes / day</FieldLabel>
          <Input
            id={`${fields}-minutes`}
            className="w-24"
            type="number"
            min={1}
            placeholder="∞"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </div>
        <div className="flex max-w-56 flex-col gap-1.5">
          <FieldLabel htmlFor={`${fields}-tokens`}>Tokens / day</FieldLabel>
          <Input
            id={`${fields}-tokens`}
            className="w-32"
            type="number"
            min={1}
            placeholder="∞"
            aria-describedby={`${fields}-tokens-hint`}
            value={tokens}
            onChange={(e) => setTokens(e.target.value)}
          />
          <FieldDescription id={`${fields}-tokens-hint`} className="text-xs">
            Counts the tokens the agent reports. One that reports none is not limited by this.
          </FieldDescription>
        </div>
        <div className="flex gap-2 self-end">
          <Button onClick={save}>Save</Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="font-semibold">{capped ? "Budget" : "Budget: unlimited"}</span>
      <span
        className="text-muted-foreground data-over:font-semibold data-over:text-destructive"
        data-over={over || undefined}
      >
        {used} in the last 24h
        {/* The colour is not the only thing that says a cap is reached. */}
        {over && <span className="sr-only"> — limit reached</span>}
      </span>
      <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
        {capped ? "Edit" : "Set a budget"}
      </Button>
    </div>
  );
}
