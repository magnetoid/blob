/** Tickets filed from the user menu, with what the browser attached to them.
 *
 * The snapshot is rendered in a sandboxed iframe. It is markup captured from someone
 * else's browser, so it is treated as hostile: the server serves it under a restrictive
 * CSP, and the sandbox attribute here allows nothing — no scripts, no forms, no
 * same-origin access.
 */

import { useEffect, useState } from 'react';
import type { FeedbackTicket } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { formatRelative } from '../messages/MessageRow.tsx';

type Filter = 'open' | 'closed' | 'all';

export function FeedbackSection({ onError }: { onError: (message: string | null) => void }) {
  const users = useStore((s) => s.users);
  const [tickets, setTickets] = useState<FeedbackTicket[]>([]);
  const [filter, setFilter] = useState<Filter>('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const [showing, setShowing] = useState<'log' | 'snapshot' | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // A filter switched while a slower request is still in flight would otherwise let
    // the stale response win and show the wrong list.
    let current = true;
    api.feedback
      .list(filter === 'all' ? undefined : filter)
      .then((response) => {
        if (current) setTickets(response.tickets);
      })
      .catch(() => {
        if (current) onError('Could not load feedback.');
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [filter, onError]);

  async function setStatus(ticket: FeedbackTicket, status: 'open' | 'closed') {
    try {
      const { ticket: updated } = await api.feedback.setStatus(ticket.id, status);
      setTickets((current) =>
        filter === 'all'
          ? current.map((item) => (item.id === updated.id ? updated : item))
          : current.filter((item) => item.id !== updated.id),
      );
    } catch {
      onError('Could not update that ticket.');
    }
  }

  async function remove(ticket: FeedbackTicket) {
    try {
      await api.feedback.remove(ticket.id);
      setTickets((current) => current.filter((item) => item.id !== ticket.id));
      setOpenId(null);
    } catch {
      onError('Could not delete that ticket.');
    }
  }

  return (
    <div>
      <div className="chip-row" style={{ marginBottom: 16 }}>
        {(['open', 'closed', 'all'] as Filter[]).map((value) => (
          <button
            key={value}
            className="chip"
            aria-pressed={filter === value}
            onClick={() => {
              setOpenId(null);
              setLoading(true);
              setFilter(value);
            }}
          >
            {value === 'open' ? 'Open' : value === 'closed' ? 'Closed' : 'All'}
          </button>
        ))}
      </div>

      {loading && <p className="muted">Loading…</p>}
      {!loading && tickets.length === 0 && (
        <p className="muted">
          {filter === 'open' ? 'Nothing open. ' : 'Nothing here. '}
          Anyone can file a ticket from the user menu.
        </p>
      )}

      {tickets.map((ticket) => {
        const expanded = openId === ticket.id;
        const reporter = ticket.reporterId ? users[ticket.reporterId] : undefined;

        return (
          <div key={ticket.id} className="admin-row" style={{ display: 'block' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="feedback-kind" data-kind={ticket.kind}>
                {ticket.kind}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="admin-row-title">{ticket.title}</div>
                <div className="admin-row-meta">
                  {reporter?.displayName ?? 'Someone who has since left'} ·{' '}
                  {formatRelative(ticket.createdAt)}
                  {ticket.status === 'closed' && ' · closed'}
                </div>
              </div>
              <button
                className="btn"
                onClick={() => {
                  setShowing(null);
                  setOpenId(expanded ? null : ticket.id);
                }}
              >
                {expanded ? 'Hide' : 'Open'}
              </button>
            </div>

            {expanded && (
              <div className="feedback-detail">
                {ticket.body && <p className="feedback-body">{ticket.body}</p>}

                {Object.keys(ticket.environment).length > 0 && (
                  <dl className="feedback-env">
                    {Object.entries(ticket.environment).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                <div className="chip-row">
                  {ticket.consoleLog && (
                    <button
                      className="chip"
                      aria-pressed={showing === 'log'}
                      onClick={() => setShowing(showing === 'log' ? null : 'log')}
                    >
                      Console log
                    </button>
                  )}
                  {ticket.hasSnapshot && (
                    <button
                      className="chip"
                      aria-pressed={showing === 'snapshot'}
                      onClick={() => setShowing(showing === 'snapshot' ? null : 'snapshot')}
                    >
                      Page snapshot
                    </button>
                  )}
                  <span style={{ flex: 1 }} />
                  <button
                    className="btn"
                    onClick={() =>
                      void setStatus(ticket, ticket.status === 'open' ? 'closed' : 'open')
                    }
                  >
                    {ticket.status === 'open' ? 'Close' : 'Reopen'}
                  </button>
                  <button className="btn feedback-delete" onClick={() => void remove(ticket)}>
                    Delete
                  </button>
                </div>

                {showing === 'log' && <pre className="feedback-log">{ticket.consoleLog}</pre>}

                {showing === 'snapshot' && (
                  <iframe
                    className="feedback-snapshot"
                    title={`Page snapshot for ${ticket.title}`}
                    src={api.feedback.snapshotUrl(ticket.id)}
                    sandbox=""
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
