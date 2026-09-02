/** Send a message on to another conversation.
 *
 * Slack calls it Forward, and it is the action people reach for after "copy link" turns
 * out to be the wrong shape: a link asks the reader to leave what they are doing, while
 * a forward brings the thing to them. Blob had the link and not the forward.
 *
 * It composes a new message rather than introducing a "forwarded message" record. The
 * renderer already does blockquotes and the router already resolves /m/:id, so a forward
 * is a quote plus a permalink — which also means it behaves like any other message
 * afterwards: editable, searchable, quotable in turn, and gone if its channel is left.
 * A dedicated record would have to answer what happens when the original is deleted, and
 * "it is a quote of what was said" is a better answer than a dangling reference.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Message } from '@blob/shared';
import { useStore } from '../../lib/store.ts';
import { permalinkFor, showChannel } from '../../lib/navigation.ts';
import { showError } from '../../lib/toasts.ts';
import { trapFocus } from '../../lib/focusTrap.ts';
import { useEscape } from '../../lib/useEscape.ts';

interface Props {
  message: Message;
  onClose: () => void;
}

/** Enough of the original to recognise it, not so much that it buries the note. */
const EXCERPT_LIMIT = 400;

export function ForwardDialog({ message, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEscape(onClose);
  useEffect(() => trapFocus(dialogRef.current), []);

  const channels = useStore((s) => s.channels);
  const displayNameOf = useStore((s) => s.displayNameOf);
  const channelTitle = useStore((s) => s.channelTitle);
  const sendMessage = useStore((s) => s.sendMessage);

  const [filter, setFilter] = useState('');
  const [target, setTarget] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const options = useMemo(() => {
    const mine = Object.values(channels).filter((c) => c.membership !== null && !c.archivedAt);
    const term = filter.trim().toLowerCase();
    return mine
      .filter((c) => !term || channelTitle(c).toLowerCase().includes(term))
      .sort((a, b) => channelTitle(a).localeCompare(channelTitle(b)))
      .slice(0, 50);
  }, [channels, filter, channelTitle]);

  async function forward() {
    if (!target) return;
    setSending(true);
    const excerpt = message.body.length > EXCERPT_LIMIT
      ? `${message.body.slice(0, EXCERPT_LIMIT)}…`
      : message.body;
    // Blockquoted line by line: a quote whose second line is not quoted stops being a
    // quote halfway down.
    const quoted = excerpt.split('\n').map((line) => `> ${line}`).join('\n');
    const body = [
      note.trim(),
      `> **${displayNameOf(message.authorId)}** wrote:`,
      quoted,
      permalinkFor(message.id),
    ].filter(Boolean).join('\n\n');

    try {
      await sendMessage(target, body, null, [], false);
      onClose();
      await showChannel(target);
    } catch (err) {
      showError(err);
      setSending(false);
    }
  }

  // The backdrop is presentational; Escape above is the keyboard path out.
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Forward message"
        tabIndex={-1}
      >
        <h2 className="dialog-title">Forward message</h2>
      <label className="field">
        <span className="field-label">Add a note</span>
        <textarea
          className="input"
          name="forward-note"
          rows={2}
          value={note}
          placeholder="Optional"
          onChange={(event) => setNote(event.target.value)}
        />
      </label>

      <label className="field">
        <span className="field-label">Send to</span>
        <input
          className="input"
          name="forward-filter"
          value={filter}
          placeholder="Find a conversation"
          onChange={(event) => setFilter(event.target.value)}
        />
      </label>

      <ul className="forward-list">
        {options.length === 0 && (
          <li className="forward-empty">Nothing matches “{filter}”.</li>
        )}
        {options.map((channel) => (
          <li key={channel.id}>
            <button
              type="button"
              className="menu-item"
              aria-pressed={target === channel.id}
              data-active={target === channel.id}
              onClick={() => setTarget(channel.id)}
            >
              {channelTitle(channel)}
            </button>
          </li>
        ))}
      </ul>

      <div className="dialog-actions">
        <button className="btn" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={!target || sending}
          onClick={() => void forward()}
        >
          {sending ? 'Forwarding…' : 'Forward'}
        </button>
      </div>
      </div>
    </div>
  );
}
