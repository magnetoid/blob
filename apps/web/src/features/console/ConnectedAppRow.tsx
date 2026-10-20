/** One app signed in as a person (ADR 0029) — in their own Settings, and on the admin's
 * list of everything connected to the workspace. Disconnecting asks first: it ends every
 * token the app holds, and the app has to be connected again from its side. */

import { useState } from 'react';
import type { OAuthGrant } from '../../lib/api.ts';

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
    <div className="console-list-item">
      <div className="admin-row">
        <div className="grow min-0">
          <div className="admin-row-title">
            {title}
            <span className="role-pill" data-muted={!writes}>
              {writes ? 'reads and posts' : 'reads only'}
            </span>
          </div>
          <div className="admin-row-meta">
            {grant.vouchedBy ? `Confirmed by ${grant.vouchedBy}` : 'Registered itself'}
            {' · '}
            {grant.lastUsedAt
              ? `Last used ${new Date(grant.lastUsedAt).toLocaleString()}`
              : `Connected ${new Date(grant.createdAt).toLocaleDateString()}`}
          </div>
        </div>
        <div className="admin-row-actions">
          {confirming ? (
            <>
              <button className="btn btn-danger" onClick={onDisconnect}>
                Disconnect {label}
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </>
          ) : (
            <button className="btn btn-ghost" onClick={() => setConfirming(true)}>
              Disconnect
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
