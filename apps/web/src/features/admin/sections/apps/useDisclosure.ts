/** What a button that opens a panel under its row has to say: whether it is open, and
 * which panel it opens.
 *
 * The label stays the same whichever way the press goes, and `aria-expanded` carries the
 * state; `aria-controls` is there only while the panel is, since an id with nothing behind
 * it points nowhere. Several rows can have a button called "What it did", so the button is
 * also named by `subjectId` — the element that titles its row — which reads "What it did
 * #general" rather than the same two words down the page.
 *
 * `setOpen` is for the panel that closes itself — a form that has been saved — which then
 * puts focus back on the button, since the control that was pressed has just left the page.
 */

import { useId, useState } from 'react';

export function useDisclosure(subjectId?: string) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const toggleId = `${id}-toggle`;
  const panelId = `${id}-panel`;
  return {
    open,
    setOpen,
    /** For the panel the button opens. */
    panelId,
    /** Spread onto the `Button`. */
    buttonProps: {
      id: toggleId,
      'aria-expanded': open,
      'aria-controls': open ? panelId : undefined,
      'aria-labelledby': subjectId ? `${toggleId} ${subjectId}` : undefined,
      onClick: () => setOpen((current) => !current),
    },
  };
}
