/** Every app's recent deliveries, and a way to send a failed one again. */

import { useCallback } from 'react';
import {
  api,
  type AdminWorkspaceDelivery,
} from '../../../lib/api.ts';
import { Badge } from '../../../components/ui/badge.tsx';
import { Button } from '../../../components/ui/button.tsx';
import {
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '../../../components/ui/item.tsx';
import { formatRelative } from '../../messages/messageFormatting.ts';
import { Card, CardNotice, CardRow, CardRows } from '../../console/Card.tsx';
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
  const deliveries = data?.deliveries ?? [];

  // No data and no request in flight means the load failed. The error above says so, and
  // there is no card to draw: "No delivery attempts recorded yet" would be a claim about
  // deliveries it never read.
  if (data === null && !loading) return null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        {data === null ? (
          <CardNotice>Loading…</CardNotice>
        ) : deliveries.length === 0 ? (
          <CardNotice>No delivery attempts recorded yet.</CardNotice>
        ) : (
          <CardRows aria-label="Deliveries">
            {deliveries.map((delivery) => (
              <DeliveryRow
                key={delivery.id}
                delivery={delivery}
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
          </CardRows>
        )}
      </Card>
    </div>
  );
}

function DeliveryRow({
  delivery,
  onReplay,
}: {
  delivery: AdminWorkspaceDelivery;
  onReplay: () => void;
}) {
  const canReplay =
    delivery.status === 'failed' || delivery.status === 'dead';
  return (
    <CardRow>
      <ItemContent>
        <ItemTitle>
          {delivery.pluginName}
          <Badge variant="outline">{delivery.event}</Badge>
          <Badge variant={delivery.status === 'delivered' ? 'secondary' : 'outline'}>
            {delivery.status}
          </Badge>
        </ItemTitle>
        <ItemDescription>
          {delivery.attempts} attempts · created{' '}
          {formatRelative(delivery.createdAt)}
          {delivery.deliveredAt &&
            ` · delivered ${formatRelative(delivery.deliveredAt)}`}
          {delivery.lastStatusCode && ` · HTTP ${delivery.lastStatusCode}`}
          {delivery.lastError && ` · ${delivery.lastError}`}
        </ItemDescription>
      </ItemContent>
      {/* Only where there is something to send again, and said for which: every failed row
          has one. It used to open the row first, onto a panel holding only this button. */}
      {canReplay && (
        <ItemActions>
          <Button
            variant="outline"
            aria-label={`Replay ${delivery.event} to ${delivery.pluginName}`}
            onClick={onReplay}
          >
            Replay
          </Button>
        </ItemActions>
      )}
    </CardRow>
  );
}
