/** The ⌘/ list.
 *
 * Rendered straight from `SHORTCUTS`, so it cannot document a binding that does not
 * exist or miss one that does. That is the only reason this file is as short as it is.
 *
 * The backdrop follows `ConfirmDialog`: a `role="button"` that answers Escape, Enter and
 * Space, and closes only on a click that landed on itself rather than bubbled up from
 * the panel.
 */

import { useEffect, useRef } from 'react';
import { trapFocus } from '../lib/focusTrap.ts';
import { describeKeys, groupedShortcuts, isMac } from '../lib/shortcuts.ts';

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const mac = isMac();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => trapFocus(dialogRef.current), []);

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClose();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label="Close keyboard shortcuts"
    >
      <div
        ref={dialogRef}
        className="dialog shortcut-help"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
      >
        <h2 className="dialog-title">Keyboard shortcuts</h2>
        {groupedShortcuts().map(([group, shortcuts]) => (
          <section key={group} className="shortcut-group">
            <h3 className="section-label">{group}</h3>
            {shortcuts.map((shortcut) => (
              <div key={shortcut.id} className="shortcut-row">
                <span>{shortcut.label}</span>
                <span className="shortcut-keys">
                  {describeKeys(shortcut, mac).map((cap) => (
                    <kbd key={cap}>{cap}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
