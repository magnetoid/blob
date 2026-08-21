/** Who did what, and from where. */

import { useEffect, useState } from 'react';
import { api, type AuditEvent } from '../../../lib/api.ts';
import { formatRelative } from '../../messages/MessageRow.tsx';

/** Turns `user.role_changed` into "Role changed". */
function humanizeAction(action: string): string {
  const [, verb] = action.split('.');
  const words = (verb ?? action).replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function AuditSection() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [filter, setFilter] = useState<string>('');

  useEffect(() => {
    void api.admin
      .audit({ action: filter || undefined })
      .then((r) => setEvents(r.events))
      .catch(() => setEvents([]));
  }, [filter]);

  const actions = [...new Set(events.map((e) => e.action))].sort();

  return (
    <section>
      <div className="chip-row" style={{ marginBottom: 18 }}>
        <button className="chip" aria-pressed={filter === ''} onClick={() => setFilter('')}>
          Everything
        </button>
        {actions.map((action) => (
          <button
            key={action}
            className="chip"
            aria-pressed={filter === action}
            onClick={() => setFilter(action)}
          >
            {humanizeAction(action)}
          </button>
        ))}
      </div>

      <div className="admin-table">
        {events.map((event) => (
          <div className="admin-row" key={event.id}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="admin-row-title">
                {humanizeAction(event.action)}
                {event.targetLabel && <span className="role-pill">{event.targetLabel}</span>}
              </div>
              <div className="admin-row-meta">
                {event.actorName ?? 'Someone'} · {formatRelative(event.createdAt)}
                {event.ip && ` · ${event.ip}`}
                {Object.keys(event.metadata).length > 0 &&
                  ` · ${Object.entries(event.metadata)
                    .map(([k, v]) => `${k}: ${String(v)}`)
                    .join(', ')}`}
              </div>
            </div>
          </div>
        ))}
        {events.length === 0 && <p className="muted">Nothing recorded yet.</p>}
      </div>
    </section>
  );
}
