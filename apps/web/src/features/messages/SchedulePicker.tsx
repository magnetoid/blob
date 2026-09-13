/** The clock beside Send: send this later, and maybe again.
 *
 * Beside Send rather than in the ⋯ menu, because "now or later" is decided at the
 * moment of sending, with the message already written. Scheduling carries the body and
 * nothing else — `scheduled_messages` has no link to an attachment row, and the orphan
 * sweep would collect the file before its message went out — so the clock steps aside
 * while the tray holds a file, and says why.
 */

import { useState } from "react";
import type { ScheduleRepeat } from "@blob/shared";
import { Menu } from "../../components/Menu.tsx";
import { ClockIcon } from "../../components/Icon.tsx";
import {
  REPEAT_OPTIONS,
  earliestCustom,
  presetsFor,
} from "./schedulePresets.ts";

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
  const [open, setOpen] = useState(false);
  const [repeat, setRepeat] = useState<ScheduleRepeat | "">("");
  const [customWhen, setCustomWhen] = useState("");

  async function schedule(when: Date) {
    setOpen(false);
    if (await onSchedule(when, repeat || null)) {
      setCustomWhen("");
      setRepeat("");
    }
  }

  return (
    <div className="schedule-wrap">
      <button
        className="icon-btn schedule-trigger"
        type="button"
        aria-label={
          holdingFiles
            ? "Files can’t be scheduled — send this now"
            : "Schedule this message"
        }
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip={holdingFiles ? "Files can’t be scheduled" : "Send later"}
        data-tooltip-place="top"
        disabled={disabled || holdingFiles}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <ClockIcon size="md" />
      </button>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        className="menu schedule-menu"
      >
        {presetsFor(new Date()).map((preset) => (
          <button
            key={preset.id}
            className="menu-item"
            role="menuitem"
            type="button"
            onClick={() => void schedule(preset.at(new Date()))}
          >
            {preset.label}
          </button>
        ))}
        <div className="menu-sep" />
        {/* The menu says when; this says "and again". It applies to whichever way the
            time was picked, so "Tomorrow at 9:00" plus "Every weekday" is the standup
            reminder in two clicks — the workflow every workspace actually has. */}
        <label className="schedule-repeat">
          <span className="field-label">Repeat</span>
          <select
            className="input"
            name="schedule-repeat"
            value={repeat}
            onChange={(event) =>
              setRepeat(event.target.value as ScheduleRepeat | "")
            }
          >
            {REPEAT_OPTIONS.map((option) => (
              <option key={option.value || "once"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {/* Four moments cannot express "next Thursday at two". The native control is
            the right one here: it already knows the reader's locale, their 12- or
            24-hour clock, and how a date is spelled where they are — none of which a
            hand-rolled picker would get right for free. */}
        <label className="schedule-custom">
          <span className="field-label">Or pick a time</span>
          <input
            className="input"
            type="datetime-local"
            name="schedule-custom"
            min={earliestCustom(new Date())}
            value={customWhen}
            onChange={(event) => setCustomWhen(event.target.value)}
          />
          <button
            className="btn btn-primary"
            type="button"
            disabled={!customWhen}
            onClick={() => {
              // A datetime-local string has no zone, so it parses as local — which is
              // what the person typing it meant.
              const when = new Date(customWhen);
              if (Number.isNaN(when.getTime())) return;
              void schedule(when);
            }}
          >
            Schedule
          </button>
        </label>
      </Menu>
    </div>
  );
}
