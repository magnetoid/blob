/**
 * A fenced block of code: the text, the language it says it is, and a way to take it —
 * which is the one thing anybody does with a code block in a chat, and the thing that
 * used to mean selecting it by hand and hoping the selection stopped at the last line.
 *
 * The copy sits at the block's foot, not its head. The message toolbar overhangs the top
 * 20px of a row at its right edge, so a button at a block's top right was under the
 * toolbar whenever a message began with a fence — which a pasted query usually does. The
 * language is a label on the top border at the left, a corner the toolbar never reaches,
 * and it is only words: covering it would cost nothing anyway.
 */

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { CheckIcon, CopyIcon } from './Icon.tsx';
import { showError } from '../lib/toasts.ts';

/** Long enough to be seen after the pointer has left, short enough that a second copy
 *  of a different block does not find the first still saying it was done. */
const COPIED_MS = 1600;

export function CodeBlock({
  code,
  language,
  copyable = true,
}: {
  code: string;
  language?: string;
  /** No Copy button, for a block drawn inside something that is itself a button. */
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy(event: MouseEvent) {
    // Some of what renders markdown is itself clickable — a search hit opens its message
    // — and taking a copy is not a click on that.
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      showError(new Error('Could not copy — the browser refused the clipboard.'));
      return;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  }

  return (
    <div className="code-block" data-copied={copied ? 'true' : undefined}>
      {language && (
        <span className="code-block-lang" aria-hidden="true">
          {language}
        </span>
      )}
      <pre>
        <code data-language={language}>{code}</code>
      </pre>
      {copyable && (
        <>
          <button
            type="button"
            className="code-block-copy"
            onClick={(event) => void copy(event)}
            aria-label={copied ? 'Copied' : language ? `Copy ${language} code` : 'Copy code'}
          >
            {copied ? <CheckIcon size="sm" /> : <CopyIcon size="sm" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <span className="sr-only" role="status">
            {copied ? 'Copied to the clipboard' : ''}
          </span>
        </>
      )}
    </div>
  );
}
