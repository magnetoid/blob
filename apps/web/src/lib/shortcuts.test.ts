/**
 * The keyboard vocabulary.
 *
 * The point of `lib/shortcuts` is that one list both binds and documents, so the tests
 * that matter are the ones about *not firing*: a bare letter must not steal a keystroke
 * mid-sentence, and `⌘K` must not answer someone reaching for `⌘⇧K`. Those are the two
 * ways a shortcut layer turns from a convenience into a defect.
 */

import { describe, expect, it } from 'vitest';
import {
  SHORTCUTS,
  chordsFor,
  describeKeys,
  groupedShortcuts,
  matchShortcut,
  type Shortcut,
} from './shortcuts.ts';

function press(
  key: string,
  modifiers: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
) {
  return {
    key,
    metaKey: modifiers.meta ?? false,
    ctrlKey: modifiers.ctrl ?? false,
    shiftKey: modifiers.shift ?? false,
    altKey: modifiers.alt ?? false,
  };
}

describe('the list itself', () => {
  it('has no duplicate ids', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('binds no two shortcuts to the same chord', () => {
    // The matcher returns the first hit, so a duplicate chord would silently shadow
    // whichever was declared second. Every chord counts, including the alternatives:
    // ⌥↑ and a bare ↑ are different bindings and one of them must not eat the other.
    const chords = SHORTCUTS.flatMap((shortcut) =>
      chordsFor(shortcut).map(
        (c) => `${c.meta ? 'M' : ''}${c.shift ? 'S' : ''}${c.alt ? 'A' : ''}${c.key}`,
      ),
    );
    expect(new Set(chords).size).toBe(chords.length);
  });

  it('puts Alt only on a named key', () => {
    // On a Mac ⌥ with a letter composes a character — `event.key` for ⌥J is "∆" — and
    // on Windows AltGr sends Ctrl+Alt and does the same for a European layout. A
    // binding on the letter would simply never fire, for some people, on some
    // keyboards, with nothing to show for it. Arrows compose nothing anywhere.
    for (const shortcut of SHORTCUTS) {
      for (const chord of chordsFor(shortcut)) {
        if (chord.alt) expect(chord.key.length).toBeGreaterThan(1);
      }
    }
  });

  it('answers both chords where a shortcut has two', () => {
    const both = SHORTCUTS.find((s) => s.also);
    expect(both).toBeDefined();
    const alternative = both!.also!;

    const matched = matchShortcut(
      {
        key: alternative.key,
        metaKey: Boolean(alternative.meta),
        ctrlKey: false,
        shiftKey: Boolean(alternative.shift),
        altKey: Boolean(alternative.alt),
      },
      { typing: true },
    );

    expect(matched?.id).toBe(both!.id);
  });

  it('leaves AltGr alone', () => {
    // Ctrl+Alt is how a European layout composes "€" and the like. No binding asks for
    // both, so the exact modifier comparison is what keeps typing one from firing
    // something — which is the property, not the blanket "any Alt is not for us" the
    // matcher used to have.
    expect(
      matchShortcut(
        { key: 'e', metaKey: false, ctrlKey: true, shiftKey: false, altKey: true },
        { typing: true },
      ),
    ).toBeNull();
  });

  it('puts every shortcut in a group the help renders', () => {
    const grouped = groupedShortcuts().flatMap(([, list]) => list);
    expect(grouped).toHaveLength(SHORTCUTS.length);
  });

  it('lets no bare letter fire while typing', () => {
    // A shortcut with no modifier that survives into a text box eats a character. Escape
    // and the arrows are the allowed exceptions: neither produces text.
    const offenders = SHORTCUTS.filter(
      (s) => s.whileTyping && !s.meta && s.key.length === 1,
    );
    expect(offenders).toEqual([]);
  });
});

describe('matching', () => {
  it('finds a meta chord', () => {
    expect(matchShortcut(press('k', { meta: true }))?.id).toBe('palette');
    // Ctrl is the same shortcut off a Mac.
    expect(matchShortcut(press('k', { ctrl: true }))?.id).toBe('palette');
  });

  it('is case-insensitive on letters', () => {
    // Shift is not held here — an OS or layout can still deliver an uppercase `key`.
    expect(matchShortcut(press('K', { meta: true }))?.id).toBe('palette');
  });

  it('distinguishes a chord from the same chord with shift', () => {
    expect(matchShortcut(press('k', { meta: true }))?.id).toBe('palette');
    expect(matchShortcut(press('j', { meta: true, shift: true }))?.id).toBe('next-unread');
    // Without exact modifier matching, ⌘J would answer as ⌘⇧J or vice versa.
    expect(matchShortcut(press('j', { meta: true }))).toBeNull();
  });

  it('ignores anything with Alt held', () => {
    // AltGr composes characters on a European layout; treating it as a modifier we do
    // not use would fire shortcuts at people typing accented text.
    expect(matchShortcut(press('k', { meta: true, alt: true }))).toBeNull();
  });

  it('returns null for a key nothing is bound to', () => {
    expect(matchShortcut(press('q', { meta: true }))).toBeNull();
  });
});

describe('matching while a text box has focus', () => {
  it('still answers a meta chord', () => {
    expect(matchShortcut(press('k', { meta: true }), { typing: true })?.id).toBe('palette');
  });

  it('still answers Escape', () => {
    expect(matchShortcut(press('Escape'), { typing: true })?.id).toBe('close');
  });

  it('answers ArrowUp, which the composer then decides about', () => {
    // The binding fires while typing; whether it *does* anything is the composer's call,
    // and it only acts on an empty box.
    expect(matchShortcut(press('ArrowUp'), { typing: true })?.id).toBe('edit-last');
  });
});

describe('how keys are written', () => {
  const shortcut = (id: string): Shortcut => {
    const found = SHORTCUTS.find((s) => s.id === id);
    if (!found) throw new Error(`no shortcut ${id}`);
    return found;
  };

  it('uses symbols on a Mac and words elsewhere', () => {
    expect(describeKeys(shortcut('palette'), true)).toEqual(['⌘', 'K']);
    expect(describeKeys(shortcut('palette'), false)).toEqual(['Ctrl', 'K']);
  });

  it('spells out the keys that have no printable character', () => {
    expect(describeKeys(shortcut('close'), true)).toEqual(['Esc']);
    expect(describeKeys(shortcut('edit-last'), true)).toEqual(['↑']);
  });

  it('orders modifiers the way a keyboard is read', () => {
    expect(describeKeys(shortcut('next-unread'), true)).toEqual(['⌘', '⇧', 'J']);
  });
});

describe('marking everything read', () => {
  it('is Shift+Escape, and plain Escape is still just close', () => {
    // They share a key and are told apart by Shift alone, so this is the pair most
    // likely to swallow each other.
    const shifted = matchShortcut(
      { key: 'Escape', metaKey: false, ctrlKey: false, shiftKey: true, altKey: false },
      { typing: false },
    );
    const plain = matchShortcut(
      { key: 'Escape', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false },
      { typing: false },
    );

    expect(shifted?.id).toBe('read-all');
    expect(plain?.id).toBe('close');
  });

  it('still fires while a composer has focus', () => {
    // Escape and its chords are the exception to the typing rule; a shortcut you can
    // only use after clicking away is one nobody reaches for.
    const match = matchShortcut(
      { key: 'Escape', metaKey: false, ctrlKey: false, shiftKey: true, altKey: false },
      { typing: true },
    );

    expect(match?.id).toBe('read-all');
  });
});
