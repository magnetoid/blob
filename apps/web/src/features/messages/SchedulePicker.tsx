/** The clock beside Send: send this later, and maybe again.
 *
 * Beside Send rather than in the ⋯ menu, because "now or later" is decided at the
 * moment of sending, with the message already written. Scheduling carries the body and
 * nothing else — `scheduled_messages` has no link to an attachment row, and the orphan
 * sweep would collect the file before its message went out — so the clock steps aside
 * while the tray holds a file, and says why.
 *
 * The clock is the first-load half: a button on the page from first paint. What opens
 * from it is shadcn's Popover, a module of its own (`SchedulePanel.tsx`, through
 * `lazyPopups.ts`), which takes the button as its trigger once it has arrived.
 */

import type { ScheduleRepeat } from "@blob/shared";
import { ClockIcon } from "../../components/Icon.tsx";
import { SchedulePopup } from "./lazyPopups.ts";

export function SchedulePicker({
  disabled,
  holdingFiles,
  onSchedule,
}: {
  disabled: boolean;
  holdingFiles: boolean;
  /** Resolves true once the server has it, so the picker can forget its choices. */
  onSchedule: (when: Date, repeat: ScheduleRepeat | null) => Promise<boolean>;
}) {
  const label = holdingFiles
    ? "Files can’t be scheduled — send this now"
    : "Schedule this message";
  return (
    <SchedulePopup
      label={label}
      onSchedule={onSchedule}
      trigger={
        <button
          className="icon-btn schedule-trigger"
          type="button"
          aria-label={label}
          data-tooltip={holdingFiles ? "Files can’t be scheduled" : "Send later"}
          data-tooltip-place="top"
          disabled={disabled || holdingFiles}
        >
          <ClockIcon size="md" />
        </button>
      }
    />
  );
}
