/** Every assistant connected to this workspace as one of its people.
 *
 * A person's assistant (ADR 0016) holds a token that *is* them — their channels, their
 * private conversations, and, if they allowed it, their voice. That is theirs to make, and
 * it is still the workspace's business: this page lists every live connection with whose
 * it is, what it may do, when it last connected and when it ends, and lets an admin
 * revoke one. Revoking is audited as the admin, naming whose it was.
 *
 * Apps that signed in (ADR 0029) are listed apart from pasted tokens: one is minted a
 * token an hour, and a list of those would be a list of hours. A connected app is one row
 * however many it has held, and disconnecting it ends all of them.
 */

import { useState } from 'react';
import { api, type WorkspaceAssistantToken } from '../../../lib/api.ts';
import { Badge } from '../../../components/ui/badge.tsx';
import { Button } from '../../../components/ui/button.tsx';
import {
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '../../../components/ui/item.tsx';
import type { ConsoleSectionProps } from '../../console/ConsoleShell.tsx';
import { Card, CardNotice, CardRow, CardRows } from '../../console/Card.tsx';
import { ConnectedAppRow } from '../../console/ConnectedAppRow.tsx';
import { useAdminAction, useAdminData } from '../../console/hooks.ts';
import { formatEnds } from '../../../lib/format.ts';

export function AssistantsAdminSection({ onError }: ConsoleSectionProps) {
  const { data, loading, reload } = useAdminData(
    () => api.admin.assistantTokens(),
    [],
    onError,
    'Could not load the connections.',
  );
  const act = useAdminAction(onError, reload);
  const tokens = data?.tokens ?? [];
  const apps = useAdminData(
    () => api.admin.oauthGrants(),
    [],
    onError,
    'Could not load the connected apps.',
  );
  const actOnApps = useAdminAction(onError, apps.reload);
  const grants = apps.data?.grants ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Connected apps"
        description={
          <>
            Assistants that signed in — Claude, ChatGPT — each <strong>as its person</strong>,
            who said yes to it. Disconnecting one ends every token it holds.
          </>
        }
      >
        {apps.loading && grants.length === 0 && <CardNotice>Loading…</CardNotice>}
        {!apps.loading && grants.length === 0 && (
          <CardNotice>No app has signed in to this workspace.</CardNotice>
        )}
        {/* ConnectedAppRow is a row of CardRows, as it is in Settings, and so are the
            pasted tokens below. */}
        {grants.length > 0 && (
          <CardRows>
            {grants.map((grant) => (
              <ConnectedAppRow
                key={grant.id}
                grant={grant}
                owner={grant.ownerName}
                onDisconnect={() =>
                  void actOnApps(() => api.admin.disconnectOAuthGrant(grant.id))
                }
              />
            ))}
          </CardRows>
        )}
      </Card>

      <Card
        title="Tokens"
        description={
          <>
            Pasted into tools that cannot sign in. Each acts <strong>as its person</strong> —
            what they can see, and what they post if they allowed it. People make and end their
            own in Settings; an admin can end any.
          </>
        }
      >
        {loading && tokens.length === 0 && <CardNotice>Loading…</CardNotice>}
        {!loading && tokens.length === 0 && (
          <CardNotice>Nobody has made a token for this workspace.</CardNotice>
        )}
        {tokens.length > 0 && (
          <CardRows aria-label="Tokens">
            {tokens.map((token) => (
              <WorkspaceTokenRow key={token.id} token={token} act={act} />
            ))}
          </CardRows>
        )}
      </Card>
    </div>
  );
}

function WorkspaceTokenRow({
  token,
  act,
}: {
  token: WorkspaceAssistantToken;
  act: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const writes = token.scopes.includes('write');
  return (
    <CardRow>
      <ItemContent>
        <ItemTitle>
          {token.ownerName} · {token.name}
          <Badge variant={writes ? 'secondary' : 'outline'}>
            {writes ? 'reads and posts' : 'reads only'}
          </Badge>
        </ItemTitle>
        <ItemDescription>
          {token.lastUsedAt
            ? `Last used ${new Date(token.lastUsedAt).toLocaleString()}`
            : 'Never used'}
          {' · '}
          {formatEnds(token.expiresAt)}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        {confirming ? (
          <>
            <Button
              variant="destructive"
              onClick={() => void act(() => api.admin.revokeAssistantToken(token.id))}
            >
              Revoke {token.ownerName}&rsquo;s {token.name}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            Revoke
          </Button>
        )}
      </ItemActions>
    </CardRow>
  );
}
