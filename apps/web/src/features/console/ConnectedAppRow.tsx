/** One app signed in as a person (ADR 0029) — in their own Settings, and on the admin's
 * list of everything connected to the workspace. Disconnecting asks first: it ends every
 * token the app holds, and the app has to be connected again from its side.
 *
 * A row of `CardRows`: the caller draws the list, and the row is an item in it. */

import { useState } from 'react';
import type { OAuthGrant } from '../../lib/api.ts';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { ItemActions, ItemContent, ItemDescription, ItemTitle } from '../../components/ui/item.tsx';
import { CardRow } from './Card.tsx';

export function ConnectedAppRow({
  grant,
  owner,
  onDisconnect,
}: {
  grant: OAuthGrant;
  /** Whose it is, on the admin's list. */
  owner?: string;
  onDisconnect: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const writes = grant.scopes.includes('write');
  const title = owner ? `${owner} · ${grant.clientName}` : grant.clientName;
  const label = owner ? `${owner}’s ${grant.clientName}` : grant.clientName;

  return (
    <CardRow>
      <ItemContent>
        <ItemTitle>
          {title}
          <Badge variant={writes ? 'secondary' : 'outline'}>
            {writes ? 'reads and posts' : 'reads only'}
          </Badge>
        </ItemTitle>
        <ItemDescription>
          {grant.vouchedBy ? `Confirmed by ${grant.vouchedBy}` : 'Registered itself'}
          {' · '}
          {grant.lastUsedAt
            ? `Last used ${new Date(grant.lastUsedAt).toLocaleString()}`
            : `Connected ${new Date(grant.createdAt).toLocaleDateString()}`}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        {confirming ? (
          <>
            <Button variant="destructive" onClick={onDisconnect}>
              Disconnect {label}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            Disconnect
          </Button>
        )}
      </ItemActions>
    </CardRow>
  );
}
