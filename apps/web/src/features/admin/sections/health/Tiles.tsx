/** The two smallest readings: one service, and one number with its trend.
 *
 * Both are buttons rather than text. Every figure on this page is a question someone is
 * about to follow up on, so each one navigates to the page that explains it.
 */

import { type AdminHealth } from "../../../../lib/api.ts";
import { navigate } from "../../../../lib/router.ts";
import { Button } from "../../../../components/ui/button.tsx";
import { cn } from "cn";
import { METRICS } from "./model.ts";

/** A tile's box. A button's is the same box, with the button's own focus and hover. */
const TILE = "flex w-full flex-col items-start gap-1 rounded-lg border bg-background p-3 text-left text-sm";

/** A metric tile's quieter lines: muted, until the tile is pressed and tinted. */
const QUIET = "text-muted-foreground group-aria-pressed/button:text-foreground";

export function ServiceTile({
  label,
  value,
  bad,
  hint,
  route,
}: {
  label: string;
  value: string;
  bad?: boolean;
  hint?: string;
  /** Where pressing the tile goes. Without one it is not a control at all — a button
   *  that opens a page the viewer may not see is worse than a plain tile. */
  route?: string;
}) {
  const body = (
    <>
      <span className="font-medium text-muted-foreground">{label}</span>
      <span
        className={cn("text-lg font-semibold tabular-nums", bad && "text-destructive")}
        data-bad={bad}
      >
        {value}
      </span>
      {/* Only drawn when something is wrong, so it says what to do rather than what is. */}
      {hint && <span className="text-xs text-pretty text-muted-foreground">{hint}</span>}
    </>
  );
  if (!route) return <div className={cn(TILE, "min-h-27")}>{body}</div>;
  return (
    <Button
      variant="outline"
      className={cn(TILE, "h-auto min-h-27 justify-start font-normal whitespace-normal")}
      onClick={() => navigate(route)}
    >
      {body}
    </Button>
  );
}

export function MetricCard({
  metric,
  health,
  active,
  delta,
  onSelect,
}: {
  metric: (typeof METRICS)[number];
  health: AdminHealth;
  active: boolean;
  delta: number | null;
  onSelect: () => void;
}) {
  const trend =
    delta === null
      ? "Waiting for another sample."
      : delta === 0
        ? "No change since the previous sample."
        : `${delta > 0 ? "+" : ""}${delta.toLocaleString()} since the previous sample.`;

  return (
    // The tile the chart is showing is the one pressed: the outline button's pressed look.
    // Its name is what it says, label first, so the words a person sees are the words a
    // voice control answers to. Pressed, the tile is tinted with the primary colour, and
    // muted text on that tint is too faint to read: the quieter lines take the foreground
    // colour then, from the button's own `group/button`.
    <Button
      variant="outline"
      className={cn(TILE, "h-auto min-h-40 justify-start gap-2 p-3.5 font-normal whitespace-normal")}
      data-active={active ? "true" : "false"}
      onClick={onSelect}
      aria-pressed={active}
    >
      <span className={cn("font-medium", QUIET)}>{metric.label}</span>
      <span className="text-[length:clamp(1.2rem,2vw,1.8rem)] font-bold text-foreground tabular-nums">
        {metric.format(health)}
      </span>
      <span className={cn("text-xs text-pretty", QUIET)}>{metric.description}</span>
      <span className={cn("text-xs text-pretty", QUIET)}>{trend}</span>
    </Button>
  );
}
