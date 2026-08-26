/**
 * Keyboard shortcuts, declared once.
 *
 * The list here is both what binds and what `⌘/` shows. That is the point of the module:
 * a help dialog written separately from the handler is a help dialog that documents a
 * shortcut nobody implemented, or misses one that exists — and nothing fails, so it
 * survives. It is the same argument `realtime/protocol.py` makes about the event
 * vocabulary, at a much smaller scale.
 *
 * Slack's bindings, where Slack has one. Someone arriving from Slack should find their
 * fingers already right, which is the stated principle; inventing a better chord for
 * something they already know is a worse product even when the chord is better.
 */

export interface Shortcut {
  id: string;
  /** Shown in the help dialog, imperative and lowercase-ish: "Open a channel". */
  label: string;
  /** Grouping in the help dialog. */
  group: 'Navigation' | 'Conversation' | 'Application';
  /** `event.key`, lowercased for letters. */
  key: string;
  /** ⌘ on a Mac, Ctrl elsewhere. */
  meta?: boolean;
  shift?: boolean;
  /**
   * Whether it still fires while a text box has focus.
   *
   * Off by default, and this is the setting that decides whether a shortcut is helpful
   * or infuriating: a bare letter that steals a keystroke mid-sentence is a bug. Only
   * chords with a modifier, and Escape, set it.
   */
  whileTyping?: boolean;
}

export const SHORTCUTS: readonly Shortcut[] = [
  {
    id: 'palette',
    label: 'Jump to a channel or person',
    group: 'Navigation',
    key: 'k',
    meta: true,
    whileTyping: true,
  },
  {
    id: 'search',
    label: 'Search messages',
    group: 'Navigation',
    key: 'f',
    meta: true,
    whileTyping: true,
  },
  {
    id: 'threads',
    label: 'Threads you are in',
    group: 'Navigation',
    // Slack's chord for it, unchanged.
    key: 't',
    meta: true,
    shift: true,
    whileTyping: true,
  },
  {
    id: 'next-unread',
    label: 'Next channel with unread messages',
    group: 'Navigation',
    key: 'j',
    meta: true,
    shift: true,
    whileTyping: true,
  },
  {
    id: 'edit-last',
    label: 'Edit your last message',
    group: 'Conversation',
    key: 'ArrowUp',
    // Only from an empty composer, which the handler checks — otherwise it would fight
    // with moving the caret through what you are already writing.
    whileTyping: true,
  },
  // The formatting chords are handled by the composer, which owns the textarea and its
  // selection — like `edit-last`, they are listed here so `⌘/` documents them and the
  // toolbar tooltips can never advertise a chord the keyboard layer doesn't have.
  {
    id: 'format-bold',
    label: 'Bold the selection',
    group: 'Conversation',
    key: 'b',
    meta: true,
    whileTyping: true,
  },
  {
    id: 'format-italic',
    label: 'Italicize the selection',
    group: 'Conversation',
    key: 'i',
    meta: true,
    whileTyping: true,
  },
  {
    id: 'format-code',
    label: 'Format the selection as code',
    group: 'Conversation',
    key: 'c',
    meta: true,
    shift: true,
    whileTyping: true,
  },
  {
    id: 'format-strike',
    label: 'Strike through the selection',
    group: 'Conversation',
    key: 'x',
    meta: true,
    shift: true,
    whileTyping: true,
  },
  {
    id: 'close',
    label: 'Close the thread, dialog, or panel',
    group: 'Conversation',
    key: 'Escape',
    whileTyping: true,
  },
  {
    id: 'help',
    label: 'Show this list',
    group: 'Application',
    key: '/',
    meta: true,
    whileTyping: true,
  },
] as const;

/** Mac reads ⌘K; everyone else reads Ctrl+K. */
export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent);
}

/** How a shortcut is written in the help dialog. */
export function describeKeys(shortcut: Shortcut, mac = isMac()): string[] {
  const keys: string[] = [];
  if (shortcut.meta) keys.push(mac ? '⌘' : 'Ctrl');
  if (shortcut.shift) keys.push(mac ? '⇧' : 'Shift');
  keys.push(prettyKey(shortcut.key));
  return keys;
}

function prettyKey(key: string): string {
  if (key === 'ArrowUp') return '↑';
  if (key === 'ArrowDown') return '↓';
  if (key === 'Escape') return 'Esc';
  return key.length === 1 ? key.toUpperCase() : key;
}

/** Whether the focused element is somewhere a keystroke is text rather than a command. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
  );
}

/**
 * The shortcut a keystroke means, or null.
 *
 * Modifier matching is exact — `⌘K` and `⌘⇧K` are different shortcuts, and treating
 * `shift` as "don't care" would fire the first while someone reaches for the second.
 * `altKey` is never part of a binding and is checked so a European keyboard composing a
 * character with AltGr does not trigger anything.
 */
export function matchShortcut(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  options: { typing: boolean } = { typing: false },
): Shortcut | null {
  if (event.altKey) return null;
  const meta = event.metaKey || event.ctrlKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  for (const shortcut of SHORTCUTS) {
    if (shortcut.key !== key) continue;
    if (Boolean(shortcut.meta) !== meta) continue;
    if (Boolean(shortcut.shift) !== event.shiftKey) continue;
    if (options.typing && !shortcut.whileTyping) continue;
    return shortcut;
  }
  return null;
}

/** The help dialog's sections, in declaration order. */
export function groupedShortcuts(): [Shortcut['group'], Shortcut[]][] {
  const groups = new Map<Shortcut['group'], Shortcut[]>();
  for (const shortcut of SHORTCUTS) {
    const existing = groups.get(shortcut.group);
    if (existing) existing.push(shortcut);
    else groups.set(shortcut.group, [shortcut]);
  }
  return [...groups.entries()];
}
