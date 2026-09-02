// @vitest-environment happy-dom
/** Which controls keep their own Up and Down.
 *
 * Split from `shortcuts.test.ts` because this one needs a DOM: the question is about
 * real elements, and the answer decides whether ⌥↓ opens a select's options or navigates
 * away from the page the select was on.
 */

import { describe, expect, it } from 'vitest';
import { ownsArrowKeys } from './shortcuts.ts';

describe('controls that own their arrows', () => {
  it('names a select and the fields that step with Up and Down', () => {
    // ⌥↓ opens a select's options and steps a date, time or number field. Answering it
    // by navigating to another channel does not merely ignore the gesture — it
    // preventDefaults the one the browser was about to perform and unmounts the page
    // the control was on, taking whatever was half-filled in with it.
    const select = document.createElement('select');
    expect(ownsArrowKeys(select)).toBe(true);

    for (const type of ['date', 'datetime-local', 'time', 'number', 'range', 'month', 'week']) {
      const field = document.createElement('input');
      field.type = type;
      expect(ownsArrowKeys(field), type).toBe(true);
    }
  });

  it('and leaves the composer alone', () => {
    // Deliberately not on the list: the composer is where somebody spends the day, and
    // switching conversations from it is the point of the binding.
    const box = document.createElement('textarea');
    expect(ownsArrowKeys(box)).toBe(false);

    const text = document.createElement('input');
    text.type = 'text';
    expect(ownsArrowKeys(text)).toBe(false);
  });

  it('answers for nothing at all', () => {
    expect(ownsArrowKeys(null)).toBe(false);
  });
});
