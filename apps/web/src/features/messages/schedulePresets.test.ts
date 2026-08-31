import { describe, expect, it } from 'vitest';
import { presetsFor, SCHEDULE_PRESETS } from './schedulePresets.ts';

const at = (iso: string) => new Date(iso);

describe('schedule presets', () => {
  it('offers this evening in the morning', () => {
    const ids = presetsFor(at('2026-09-02T09:00:00')).map((p) => p.id);
    expect(ids).toContain('this-evening');
  });

  it('drops this evening once it has passed', () => {
    // A preset that appears and then fails is worse than one that is not offered.
    const ids = presetsFor(at('2026-09-02T20:00:00')).map((p) => p.id);
    expect(ids).not.toContain('this-evening');
  });

  it('means nine in the morning by "tomorrow"', () => {
    const preset = SCHEDULE_PRESETS.find((p) => p.id === 'tomorrow')!;
    const when = preset.at(at('2026-09-02T23:30:00'));
    expect(when.getDate()).toBe(3);
    expect(when.getHours()).toBe(9);
  });

  it('means next week by "Monday", never today', () => {
    // Wednesday.
    const fromWednesday = SCHEDULE_PRESETS.find((p) => p.id === 'monday')!.at(at('2026-09-02T10:00:00'));
    expect(fromWednesday.getDay()).toBe(1);
    expect(fromWednesday.getDate()).toBe(7);

    // And on a Monday it means the *next* one, not this morning.
    const fromMonday = SCHEDULE_PRESETS.find((p) => p.id === 'monday')!.at(at('2026-09-07T10:00:00'));
    expect(fromMonday.getDate()).toBe(14);
  });

  it('always leaves the server room to accept it', () => {
    for (const preset of presetsFor(at('2026-09-02T09:00:00'))) {
      expect(preset.at(at('2026-09-02T09:00:00')).getTime()).toBeGreaterThan(
        at('2026-09-02T09:00:00').getTime() + 60_000,
      );
    }
  });
});
