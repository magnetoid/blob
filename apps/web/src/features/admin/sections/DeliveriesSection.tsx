/** Every app's recent deliveries, and a way to send a failed one again. */

import { useCallback, useState } from 'react';
import {
  api,
  type AdminWorkspaceDelivery,
} from '../../../lib/api.ts';
import { formatRelative } from '../../messages/messageFormatting.ts';
import { Card, CardNotice } from '../../console/Card.tsx';
import { useAdminAction, useAdminData } from '../../console/hooks.ts';

export function DeliveriesSection({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const load = useCallback(() => api.admin.workspaceDeliveries(), []);
  const { data, loading, reload } = useAdminData(
    load,
    [],
    onError,
    'Could not load deliveries.',
  );
  const act = useAdminAction(onError, reload);
  const [openId, setOpenId] = useState<string | null>(null);
  const deliveries = data?.deliveries ?? [];

  // No data and no request in flight means the load failed. The error above says so, and
  // there is no card to draw: "No delivery attempts recorded yet" would be a claim about
  // deliveries it never read.
  if (data === null && !loading) return null;

  return (
    <div className="console-stack">
      <Card>
        {data === null ? (
          <CardNotice>Loading…</CardNotice>
        ) : deliveries.length === 0 ? (
          <CardNotice>No delivery attempts recorded yet.</CardNotice>
        ) : (
          <div className="console-list">
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
      </Card>
    </div>
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
      <div className="grow min-0">
        <button
          type="button"
          className="console-row-toggle"
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
          <div className="console-row-more">
            <button className="btn" type="button" onClick={onReplay}>
              Replay
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
