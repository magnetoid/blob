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
import type { ConsoleSectionProps } from '../../console/ConsoleShell.tsx';
import { Card, CardNotice } from '../../console/Card.tsx';
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
    <div className="console-stack">
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
        {grants.length > 0 && (
          <div className="console-list">
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
          </div>
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
          <div className="console-list">
            {tokens.map((token) => (
              <WorkspaceTokenRow key={token.id} token={token} act={act} />
            ))}
          </div>
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
    <div className="console-list-item">
      <div className="admin-row">
        <div className="grow min-0">
          <div className="admin-row-title">
            {token.ownerName} · {token.name}
            <span className="role-pill" data-muted={!writes}>
              {writes ? 'reads and posts' : 'reads only'}
            </span>
          </div>
          <div className="admin-row-meta">
            {token.lastUsedAt
              ? `Last used ${new Date(token.lastUsedAt).toLocaleString()}`
              : 'Never used'}
            {' · '}
            {formatEnds(token.expiresAt)}
          </div>
        </div>
        <div className="admin-row-actions">
          {confirming ? (
            <>
              <button
                className="btn btn-danger"
                onClick={() => void act(() => api.admin.revokeAssistantToken(token.id))}
              >
                Revoke {token.ownerName}&rsquo;s {token.name}
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </>
          ) : (
            <button className="btn btn-ghost" onClick={() => setConfirming(true)}>
              Revoke
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
