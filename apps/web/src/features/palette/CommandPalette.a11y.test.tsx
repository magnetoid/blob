// @vitest-environment happy-dom
/**
 * ⌘K, announced.
 *
 * The palette is the main way to get anywhere in this app, and it was a plain text input
 * over a stack of plain buttons. Arrowing moved a highlight that existed only in CSS —
 * focus never leaves the input, so there was nothing for a screen reader to follow and
 * no way to know what Enter was about to do. That is the combobox pattern's whole
 * purpose: `aria-activedescendant` makes a moving selection audible while the focused
 * element stays put.
 *
 * The pattern is cmdk's now, and cmdk writes most of it. One part it gets wrong is pinned
 * here on purpose: cmdk 1.1.1 hard-codes `aria-expanded="true"` on its input after the
 * props it is given, so a combobox over an empty list would claim a popup it does not have
 * unless the palette corrects it.
 *
 * These read the attributes rather than trusting the markup, because the failure mode is
 * silent by construction — everything looks and behaves correctly with a mouse.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CommandPalette from './CommandPalette.tsx';
import { useStore } from '../../lib/store.ts';
import '../../test/overlayChunk.ts';

afterEach(cleanup);

function open() {
  useStore.setState({
    channels: {
      c1: { id: 'c1', kind: 'public', name: 'design', archivedAt: null },
      c2: { id: 'c2', kind: 'public', name: 'engineering', archivedAt: null },
    },
    users: {},
    currentUser: { id: 'u1', displayName: 'Me', prefs: {} },
  } as never);
  render(<CommandPalette onClose={vi.fn()} />);
  return screen.getByRole('combobox') as HTMLInputElement;
}

/** What the input claims is selected, resolved to the element it names. */
function active(input: HTMLInputElement) {
  const id = input.getAttribute('aria-activedescendant');
  return id ? document.getElementById(id) : null;
}

describe('the command palette', () => {
  it('is a combobox over a listbox of options', () => {
    const input = open();

    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(
      document.getElementById(input.getAttribute('aria-controls')!)?.getAttribute('role'),
    ).toBe('listbox');
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    // What it is called is what it searches, whichever of its labels a reader takes.
    expect(
      screen.getByRole('combobox', { name: 'Search everything — Tab changes what is searched' }),
    ).toBe(input);
  });

  it('names the highlighted row, and names a different one after an arrow', () => {
    // The assertion that pins the bug: without aria-activedescendant this is null both
    // times, and the arrow key changes nothing an assistive technology can perceive.
    const input = open();
    const first = active(input);
    expect(first).not.toBeNull();
    expect(first!.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(input, { key: 'ArrowDown' });

    const second = active(input);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(second!.getAttribute('aria-selected')).toBe('true');
    expect(first!.getAttribute('aria-selected')).toBe('false');
  });

  it('names the row a new query selected, not the one an arrow left selected', () => {
    // cmdk selects the first row for a new query, and reads which row that is off the
    // page before the page shows it: left alone, the input names the row the last query
    // had selected, which is still on the list and is not where Enter would go.
    const input = open();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(active(input)?.textContent).toContain('engineering');

    fireEvent.change(input, { target: { value: 'g' } });

    const named = active(input);
    expect(named?.getAttribute('aria-selected')).toBe('true');
    expect(named?.textContent).toContain('design');
    expect(screen.getByText('engineering')).toBeTruthy();
  });

  it('says it is not expanded when nothing matched, and expanded again when something does', () => {
    const input = open();
    fireEvent.change(input, { target: { value: 'zzzznothing' } });

    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();

    fireEvent.change(input, { target: { value: 'des' } });

    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(active(input)?.getAttribute('aria-selected')).toBe('true');
  });

  it('leaves Home and End to the caret, and ⌘↓ ⌘↑ to the first and last row', () => {
    // An editable combobox's Home and End belong to the text (APG): cmdk would take them
    // for the first and last row, and its preventDefault would keep the caret where it was.
    const input = open();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const selected = active(input);
    expect(selected?.textContent).toContain('engineering');

    expect(fireEvent.keyDown(input, { key: 'End' })).toBe(true);
    expect(active(input)).toBe(selected);
    expect(fireEvent.keyDown(input, { key: 'Home' })).toBe(true);
    expect(active(input)).toBe(selected);
    expect(fireEvent.keyDown(input, { key: 'Home', shiftKey: true })).toBe(true);
    expect(active(input)).toBe(selected);

    const rows = document.querySelectorAll('[cmdk-item]');
    fireEvent.keyDown(input, { key: 'ArrowDown', metaKey: true });
    expect(active(input)).toBe(rows[rows.length - 1]);
    fireEvent.keyDown(input, { key: 'ArrowUp', metaKey: true });
    expect(active(input)).toBe(rows[0]);
  });

  it('steps the scope with Tab and back with Shift+Tab', () => {
    // Tab is the scope key here, not a focus key: focus never leaves a combobox's input,
    // so the key is claimed — and a claimed Tab is one that moves nothing else.
    const input = open();

    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(false);
    expect(screen.getByRole('combobox', { name: /^Search channels/ })).toBe(input);
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(screen.getByRole('combobox', { name: /^Search people/ })).toBe(input);

    expect(fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(screen.getByRole('combobox', { name: /^Search channels/ })).toBe(input);
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('combobox', { name: /^Search everything/ })).toBe(input);
    // A ring, so backwards from the start is the far end rather than a dead stop.
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('combobox', { name: /^Search files/ })).toBe(input);
  });
});
