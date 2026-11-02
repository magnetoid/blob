/** A value shown once, with its Copy: an invitation link, a webhook's signing secret, a
 * callback URL to paste into a provider's console.
 *
 * A read-only field rather than a line of text, so the value can be selected and read
 * whole however long it is, and has a name of its own for a screen reader. Copy says it
 * worked in a status beside it, which is announced and then goes after two seconds.
 * Where the browser will not copy — a page reached over plain http on a local network
 * has no clipboard — the field selects the value for copying by hand rather than
 * claiming a copy that did not happen.
 */

import { useEffect, useRef, useState } from 'react';
import { CopyIcon } from '../../components/Icon.tsx';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '../../components/ui/input-group.tsx';

/** How long "Copied" stays. */
const NOTE_MS = 2000;

export function CopyField({
  value,
  label,
  copiedNote = 'Copied',
}: {
  value: string;
  /** The field's accessible name: "Invitation link", "Signing secret". */
  label: string;
  /** What the status says once the value is on the clipboard. */
  copiedNote?: string;
}) {
  const field = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [note, setNote] = useState('');

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    window.clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setNote('');
      field.current?.focus();
      field.current?.select();
      return;
    }
    setNote(copiedNote);
    timer.current = window.setTimeout(() => setNote(''), NOTE_MS);
  };

  return (
    <InputGroup>
      <InputGroupInput
        ref={field}
        value={value}
        readOnly
        aria-label={label}
        className="font-mono"
        onFocus={(event) => event.currentTarget.select()}
      />
      <InputGroupAddon align="inline-end">
        {/* There before anything is said in it, so the words are announced when they arrive. */}
        <span role="status" className="text-xs font-normal text-muted-foreground">
          {note}
        </span>
        <InputGroupButton onClick={() => void copy()}>
          <CopyIcon size="sm" />
          Copy
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
