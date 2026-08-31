// @vitest-environment happy-dom
/**
 * Arrows walk the conversation.
 *
 * The row is a tab stop because that is the only route a keyboard has to react, reply
 * and the ••• menu — which in a channel of six hundred messages means Tab alone is six
 * hundred presses to reach the composer. The affordance that made the actions usable
 * made the page unusable, so arrows move between rows and Tab moves past the list.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent } from '@testing-library/react';
import { moveFocusBetweenMessages } from './arrowNavigation.ts';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

/** The row's handler is self-contained: it reads the DOM, so the DOM is the fixture. */
function rows(count: number) {
  document.body.innerHTML = Array.from({ length: count }, (_, i) =>
    `<article class="message" tabindex="0" data-message-id="m${i}"></article>`).join('')
    + '<button id="after">composer</button>';
  return [...document.querySelectorAll<HTMLElement>('[data-message-id]')];
}

/** The real handler, on the real rows. */
function wire(list: HTMLElement[]) {
  for (const row of list) {
    row.addEventListener('keydown', moveFocusBetweenMessages as unknown as EventListener);
  }
}

describe('arrowing through messages', () => {
  it('moves down and back up', () => {
    const list = rows(4) as HTMLElement[];
    wire(list);
    list[1]!.focus();

    fireEvent.keyDown(list[1]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(list[2]!);

    fireEvent.keyDown(list[2]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(list[1]!);
  });

  it('stays put at both ends rather than wrapping', () => {
    // Wrapping from the newest message to the oldest would be a jump of six hundred
    // rows dressed up as a keypress.
    const list = rows(3) as HTMLElement[];
    wire(list);

    list[0]!.focus();
    fireEvent.keyDown(list[0]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(list[0]!);

    list[2]!.focus();
    fireEvent.keyDown(list[2]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(list[2]!);
  });

  it('leaves arrows alone when they came from inside the row', () => {
    // The editor and the ••• menu both use arrows; stealing them there would be worse
    // than not having this at all.
    const list = rows(3) as HTMLElement[];
    wire(list);
    const inner = document.createElement('textarea');
    list[1]!.append(inner);
    list[1]!.focus();

    fireEvent.keyDown(inner, { key: 'ArrowDown' });

    expect(document.activeElement).toBe(list[1]!);
  });
});
