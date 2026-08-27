/** Catch Me Up — the unread, summarised, and gone the moment you close it.
 *
 * The summary exists only in this dialog: nothing is stored, nothing is broadcast,
 * and nobody is told you asked. "Post to channel" sends it as an ordinary message
 * from *you*, idempotent on the summarised range, so pressing it twice posts once.
 */

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { showError } from '../../lib/toasts.ts';
import { trapFocus } from '../../lib/focusTrap.ts';

interface Summary {
  channelId: string;
  channelName: string | null;
  text: string;
  messageCount: number;
  upToMessageId: string;
}

export function CatchUpPanel({
  channelId,
  onClose,
}: {
  /** One channel, or null for the busiest unread few. */
  channelId: string | null;
  onClose: () => void;
}) {
  const currentUser = useStore((s) => s.currentUser);
  const [summaries, setSummaries] = useState<Summary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<Set<string>>(new Set());
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => trapFocus(dialogRef.current), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    void api.agentic
      .catchup(channelId)
      .then((r) => {
        if (!cancelled) setSummaries(r.summaries);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError && err.code === 'llm_not_configured'
            ? 'No model is configured on this server, so there is nothing to summarise with.'
            : err instanceof Error
              ? err.message
              : 'That didn’t work.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  async function post(summary: Summary) {
    if (!currentUser) return;
    setPosted((c) => new Set(c).add(summary.channelId));
    try {
      // As the person, through the ordinary send — no bot, no new permission
      // surface. The client id is derived from the range, so twice posts once.
      await api.messages.send(summary.channelId, {
        body: `**Catch-up** (${summary.messageCount} messages)\n${summary.text}`,
        clientMsgId: catchupClientId(currentUser.id, summary.upToMessageId),
        threadRootId: null,
        attachmentIds: [],
      });
    } catch (err) {
      showError(err);
      setPosted((c) => {
        const next = new Set(c);
        next.delete(summary.channelId);
        return next;
      });
    }
  }

  async function markRead(summary: Summary) {
    try {
      // Ratchet-safe: /read only ever moves forward.
      await api.channels.markRead(summary.channelId, summary.upToMessageId);
    } catch (err) {
      showError(err);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="dialog catchup-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Catch me up"
      >
        <h2 className="dialog-title">Catch me up</h2>
        {error && <p className="error-text">{error}</p>}
        {!error && summaries === null && <p className="muted">Reading the unread…</p>}
        {summaries !== null && summaries.length === 0 && (
          <p className="muted">Nothing unread — you’re caught up.</p>
        )}
        {summaries?.map((summary) => (
          <section key={summary.channelId} className="catchup-summary">
            <div className="catchup-head">
              <strong>#{summary.channelName ?? 'conversation'}</strong>
              <span className="muted"> · {summary.messageCount} messages</span>
            </div>
            <p className="catchup-text">{summary.text}</p>
            <div className="catchup-actions">
              <button
                className="btn btn-ghost"
                disabled={posted.has(summary.channelId)}
                onClick={() => void post(summary)}
              >
                {posted.has(summary.channelId) ? 'Posted' : 'Post to channel'}
              </button>
              <button className="btn btn-ghost" onClick={() => void markRead(summary)}>
                Mark as read
              </button>
            </div>
          </section>
        ))}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Stable per (person, range): the idempotency that makes double-click safe. */
function catchupClientId(userId: string, upToMessageId: string): string {
  return `catchup-${userId.slice(0, 8)}-${upToMessageId}`;
}
