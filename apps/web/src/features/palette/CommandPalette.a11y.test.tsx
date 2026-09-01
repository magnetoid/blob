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
 * These read the attributes rather than trusting the markup, because the failure mode is
 * silent by construction — everything looks and behaves correctly with a mouse.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CommandPalette } from './CommandPalette.tsx';
import { useStore } from '../../lib/store.ts';

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

  it('says it is not expanded when nothing matched', () => {
    const input = open();
    fireEvent.change(input, { target: { value: 'zzzznothing' } });

    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
  });
});
