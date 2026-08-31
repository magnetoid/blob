import { describe, expect, it } from 'vitest';
import { earliestCustom, presetsFor, SCHEDULE_PRESETS } from './schedulePresets.ts';

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

describe('the earliest custom time', () => {
  it('is a local-clock string the native control accepts', () => {
    // Not toISOString: that converts to UTC, which is the wrong clock for
    // datetime-local and would offer a floor in the past or the future depending on
    // which side of Greenwich you are.
    const floor = earliestCustom(new Date('2026-09-02T09:00:00'));

    expect(floor).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(floor).toBe('2026-09-02T09:01');
  });

  it('rolls the date over at midnight rather than producing hour 24', () => {
    expect(earliestCustom(new Date('2026-09-02T23:59:30'))).toBe('2026-09-03T00:00');
  });

  it('leaves the server room to accept it', () => {
    const now = new Date('2026-09-02T09:00:00');
    expect(new Date(earliestCustom(now)).getTime()).toBeGreaterThan(now.getTime() + 30_000);
  });
});
