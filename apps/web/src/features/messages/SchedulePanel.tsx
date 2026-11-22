/**
 * The clock's popover, as a module of its own (`lazyPopups.ts`): shadcn's Popover, which is
 * Base UI's, so a click outside, Escape and focus going back to the clock are all its own.
 * The clock is handed in as `trigger` and is the popover's own button.
 *
 * What is in it is an ordinary form, not a menu: preset buttons, a Repeat select and a time
 * field, all of which keep the keys a native control has — the select its arrows, the field
 * its digits. That is why this is a popover and was a menu only while Blob's own `Menu` had
 * nothing else to be. While open it holds its place on the Escape stack
 * (`lib/useMenuEscapeLayer.ts`), so that Escape is the popover's and not the thread's or the
 * file panel's behind it. The choices live here, above the popup, which is unmounted on
 * close: a time half-typed survives a stray click outside, and is forgotten once the server
 * has the message.
 */

import { useId, useState } from 'react';
import type { ScheduleRepeat } from '@blob/shared';
import { useMenuEscapeLayer } from '../../lib/useMenuEscapeLayer.ts';
import type { TriggerModuleProps } from '../../components/lazyTrigger.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { NativeSelect } from '../../components/ui/native-select.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.tsx';
import { Separator } from '../../components/ui/separator.tsx';
import { REPEAT_OPTIONS, earliestCustom, presetsFor } from './schedulePresets.ts';

export interface SchedulePanelProps extends TriggerModuleProps {
  /** What the popover is called: the clock's own name for itself. */
  label: string;
  /** Resolves true once the server has it, so the panel can forget its choices. */
  onSchedule: (when: Date, repeat: ScheduleRepeat | null) => Promise<boolean>;
}

const LABEL = 'flex flex-col gap-1.5 text-xs font-medium';

export default function SchedulePanel({
  trigger,
  defaultOpen,
  label,
  onSchedule,
}: SchedulePanelProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const { popupRef, triggerRef } = useMenuEscapeLayer(open, setOpen);
  const [repeat, setRepeat] = useState<ScheduleRepeat | ''>('');
  const timeId = useId();
  const [customWhen, setCustomWhen] = useState('');

  async function schedule(when: Date) {
    setOpen(false);
    if (await onSchedule(when, repeat || null)) {
      setCustomWhen('');
      setRepeat('');
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger ref={triggerRef} render={trigger} />
      {/* Above the composer, which sits at the bottom of the window, from the clock's right
          edge. */}
      <PopoverContent
        ref={popupRef}
        side="top"
        align="end"
        sideOffset={6}
        aria-label={label}
        className="w-60"
      >
        <div className="flex flex-col">
          {presetsFor(new Date()).map((preset) => (
            <Button
              key={preset.id}
              variant="ghost"
              className="justify-start"
              onClick={() => void schedule(preset.at(new Date()))}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <Separator />
        {/* The presets say when; this says "and again". It applies to whichever way the
            time was picked, so "Tomorrow at 9:00" plus "Every weekday" is the standup
            reminder in two clicks — the workflow every workspace actually has. */}
        <label className={LABEL}>
          Repeat
          <NativeSelect
            className="w-full"
            name="schedule-repeat"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value as ScheduleRepeat | '')}
          >
            {REPEAT_OPTIONS.map((option) => (
              <option key={option.value || 'once'} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        {/* Four moments cannot express "next Thursday at two". The native control is the
            right one here: it already knows the reader's locale, their 12- or 24-hour
            clock, and how a date is spelled where they are — none of which a hand-rolled
            picker would get right for free. */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={timeId} className={LABEL}>
            Or pick a time
            <Input
              id={timeId}
              type="datetime-local"
              name="schedule-custom"
              min={earliestCustom(new Date())}
              value={customWhen}
              onChange={(event) => setCustomWhen(event.target.value)}
            />
          </label>
          <Button
            disabled={!customWhen}
            onClick={() => {
              // A datetime-local string has no zone, so it parses as local — which is what
              // the person typing it meant.
              const when = new Date(customWhen);
              if (Number.isNaN(when.getTime())) return;
              void schedule(when);
            }}
          >
            Schedule
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
