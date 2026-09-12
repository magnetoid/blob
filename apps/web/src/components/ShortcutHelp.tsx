/** The ⌘/ list.
 *
 * Rendered straight from `SHORTCUTS`, so it cannot document a binding that does not
 * exist or miss one that does. That is the only reason this file is as short as it is.
 *
 * Escape, the backdrop and focus are `Dialog`'s. This file had lost its own Escape
 * binding under a comment saying it was bound above; a shared scaffold cannot lose it.
 */

import { useEffect, useRef } from 'react';
import { navigate } from '../lib/router.ts';
import { chordsFor, describeKeys, groupedShortcuts, isMac } from '../lib/shortcuts.ts';
import { Dialog } from './Dialog.tsx';

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const mac = isMac();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <Dialog label="Keyboard shortcuts" onClose={onClose}>
      <div ref={dialogRef} className="dialog shortcut-help" tabIndex={-1}>
        <h2 className="dialog-title">Keyboard shortcuts</h2>
        {groupedShortcuts().map(([group, shortcuts]) => (
          <section key={group} className="shortcut-group">
            <h3 className="section-label">{group}</h3>
            {shortcuts.map((shortcut) => (
              <div key={shortcut.id} className="shortcut-row">
                <span>{shortcut.label}</span>
                <span className="shortcut-keys">
                  {chordsFor(shortcut).map((chord, index) => (
                    <span key={index} className="shortcut-chord">
                      {/* Two chords for one action read as alternatives rather than as
                          a sequence, which is what the separator is doing here. */}
                      {index > 0 && <span className="shortcut-or">or</span>}
                      {describeKeys(chord, mac).map((cap) => (
                        <kbd key={cap}>{cap}</kbd>
                      ))}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}

        {/* The keys are only half of what somebody pressing ⌘/ is looking for. This is
            the other half, and it is one click rather than a menu they have to know is
            there. */}
        <button
          type="button"
          className="shortcut-help-more"
          onClick={() => {
            onClose();
            navigate('/help');
          }}
        >
          Everything else: how Blob works →
        </button>
      </div>
    </Dialog>
  );
}
