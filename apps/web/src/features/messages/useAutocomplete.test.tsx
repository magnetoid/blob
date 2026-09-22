// @vitest-environment happy-dom
/**
 * The highlighted row under the message field is a *thing*, not a position.
 *
 * A list can change while it is open without anybody typing — the `@` list re-ranks when
 * a conversation's members arrive or a tag of yours lands — and a highlight held by
 * position then sits on a different name. Enter takes whatever it sits on, and
 * `aria-activedescendant` did not move, so a screen reader said nothing either.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import { useAutocomplete } from './useAutocomplete.ts';

interface Row {
  key: string;
}

const rows = (...keys: string[]): Row[] => keys.map((key) => ({ key }));

function press(hook: { current: ReturnType<typeof useAutocomplete<Row>> }, key: string) {
  act(() => {
    hook.current.handleKey({ key, preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLTextAreaElement>);
  });
}

function open(initial: Row[]) {
  const onPick = vi.fn();
  const hook = renderHook(
    ({ candidates }: { candidates: Row[] }) =>
      useAutocomplete(candidates, (row) => row.key, onPick),
    { initialProps: { candidates: initial } },
  );
  return { ...hook, onPick };
}

afterEach(cleanup);

describe('the highlight', () => {
  it('stays on the same row when the list re-orders under it', () => {
    const { result, rerender, onPick } = open(rows('ana', 'bruno', 'cleo'));
    press(result, 'ArrowDown');
    expect(result.current.index).toBe(1);

    rerender({ candidates: rows('cleo', 'ana', 'bruno') });

    expect(result.current.index).toBe(2);
    press(result, 'Enter');
    expect(onPick).toHaveBeenCalledWith({ key: 'bruno' });
  });

  it('moves on from where the row is now, not from where it was', () => {
    const { result, rerender } = open(rows('ana', 'bruno', 'cleo'));
    press(result, 'ArrowDown');
    rerender({ candidates: rows('bruno', 'cleo', 'ana') });

    press(result, 'ArrowDown');

    expect(result.current.index).toBe(1);
  });

  it('goes back to the top only when its row is gone', () => {
    const { result, rerender, onPick } = open(rows('ana', 'bruno', 'cleo'));
    press(result, 'ArrowDown');

    rerender({ candidates: rows('ana', 'cleo') });

    expect(result.current.index).toBe(0);
    press(result, 'Enter');
    expect(onPick).toHaveBeenCalledWith({ key: 'ana' });
  });

  it('goes back to the top when reset', () => {
    const { result } = open(rows('ana', 'bruno'));
    press(result, 'ArrowDown');

    act(() => result.current.reset());

    expect(result.current.index).toBe(0);
  });

  it('wraps at both ends', () => {
    const { result } = open(rows('ana', 'bruno'));
    press(result, 'ArrowUp');
    expect(result.current.index).toBe(1);
    press(result, 'ArrowDown');
    expect(result.current.index).toBe(0);
  });
});
