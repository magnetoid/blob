/**
 * How a dialog's contents tell the shell around them what kind of dialog they are.
 *
 * The shell — Base UI's root, portal, backdrop and popup, in the overlay chunk
 * (`components/overlays/DialogImpl.tsx`) — is mounted *above* the component that renders
 * `<Dialog>`, not inside it: Base UI draws a portal's contents a render or two after the
 * portal, so a body rendered by a shell inside its caller would not exist yet when that
 * caller's effects ran, and every form here focuses its first field in one. So the shell
 * comes first, with nothing to go on, and the `Dialog` or `ConfirmDialog` inside it says
 * what it needs: its accessible name, the variant's host class, what closing means, and
 * whether it is an alert.
 *
 * First-load code, because the public `Dialog` reads it before the chunk is anybody's
 * business. The context is consumed once: whoever registers puts `null` back for its own
 * children, so a dialog opened from inside a dialog gets a shell of its own.
 */

import { createContext, useContext } from 'react';

export interface DialogConfig {
  /** What assistive tech calls the dialog. */
  label: string;
  /** A variant's host class (`lightbox-host`, `palette-host`), on the element that holds
   *  the backdrop and the panel. */
  className?: string | undefined;
  /** An alert dialog asks a question: `role="alertdialog"`, no closing on a click beside
   *  it, and focus on the dialog itself rather than on an answer. */
  alert?: boolean | undefined;
}

export interface DialogHost {
  /** Called by the contents as they mount and whenever what they say changes. */
  register(config: DialogConfig, onClose: () => void): void;
}

export const DialogHostContext = createContext<DialogHost | null>(null);

/** The shell this is drawn inside, or null when there is none to register with. */
export function useDialogHost(): DialogHost | null {
  return useContext(DialogHostContext);
}
