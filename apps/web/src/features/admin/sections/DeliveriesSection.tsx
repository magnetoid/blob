/** Every app's recent deliveries, and a way to send a failed one again. */

import { useCallback, useState } from 'react';
import {
  api,
  type AdminWorkspaceDelivery,
} from '../../../lib/api.ts';
import { formatRelative } from '../../messages/messageFormatting.ts';
import { useAdminAction, useAdminData } from '../hooks.ts';

export function DeliveriesSection({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const load = useCallback(() => api.admin.workspaceDeliveries(), []);
  const { data, reload } = useAdminData(
    load,
    [],
    onError,
    'Could not load deliveries.',
  );
  const act = useAdminAction(onError, reload);
  const [openId, setOpenId] = useState<string | null>(null);
  const deliveries = data?.deliveries ?? [];

  return (
    <section>
      {deliveries.length === 0 ? (
        <p className="muted">No delivery attempts recorded yet.</p>
      ) : (
        <div className="admin-table">
          {deliveries.map((delivery) => (
            <DeliveryRow
              key={delivery.id}
              delivery={delivery}
              open={openId === delivery.id}
              onToggle={() =>
                setOpenId((current) =>
                  current === delivery.id ? null : delivery.id,
                )
              }
              onReplay={() =>
                void act(() =>
                  api.admin.replayPluginDelivery(
                    delivery.pluginId,
                    delivery.id,
                  ),
                )
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

function DeliveryRow({
  delivery,
  open,
  onToggle,
  onReplay,
}: {
  delivery: AdminWorkspaceDelivery;
  open: boolean;
  onToggle: () => void;
  onReplay: () => void;
}) {
  const canReplay =
    delivery.status === 'failed' || delivery.status === 'dead';
  return (
    <div className="admin-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <button
          type="button"
          style={{ width: '100%', textAlign: 'left' }}
          onClick={onToggle}
          aria-expanded={open}
        >
          <div className="admin-row-title">
            {delivery.pluginName}
            <span className="role-pill" data-muted>
              {delivery.event}
            </span>
            <span
              className="role-pill"
              data-muted={delivery.status !== 'delivered'}
            >
              {delivery.status}
            </span>
          </div>
          <div className="admin-row-meta">
            {delivery.attempts} attempts · created{' '}
            {formatRelative(delivery.createdAt)}
            {delivery.deliveredAt &&
              ` · delivered ${formatRelative(delivery.deliveredAt)}`}
            {delivery.lastStatusCode && ` · HTTP ${delivery.lastStatusCode}`}
            {delivery.lastError && ` · ${delivery.lastError}`}
          </div>
        </button>
        {open && canReplay && (
          <div style={{ padding: '8px 0 4px' }}>
            <button className="btn" type="button" onClick={onReplay}>
              Replay
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
