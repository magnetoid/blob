/** Is there a LiveKit, and is it answering? The instance admin's question — a workspace
 * admin gets one line, and the page never asks the server on their behalf.
 *
 * Always a card of its own, titled "Media server", whatever it has to say — the empty,
 * loading and forbidden lines included. The redesign put every part of a console page
 * in a card; a bare paragraph floating above one would be the loose row it replaced.
 */

import { useCallback } from 'react';
import { api, ApiError, type MediaServerStatus } from '../../../../lib/api.ts';
import { useStore } from '../../../../lib/store.ts';
import { Card, CardNotice } from '../../../console/Card.tsx';
import { useAdminData } from '../../../console/hooks.ts';

export function MediaServerPanel({
  isOwner,
  onError,
}: {
  isOwner: boolean;
  onError: (message: string | null) => void;
}) {
  const available = useStore((s) => s.callsAvailable);
  const read = useCallback(async (): Promise<MediaServerStatus | 'forbidden' | null> => {
    if (!isOwner) return null;
    return api.admin.mediaServer().catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 403) return 'forbidden';
      throw err;
    });
  }, [isOwner]);
  const { data, reload } = useAdminData(
    read,
    [isOwner],
    onError,
    'Could not reach the media server.',
  );

  // Two different silences, and they must not read alike. A workspace admin is simply
  // not the audience for a media server's health. A refusal is the other one: this page
  // asks on the strength of owning the *workspace*, while the route answers only an
  // instance admin — the person who runs the server — and somebody who owns a workspace
  // without running the server would otherwise be told nothing and given no reason.
  if (!isOwner || data === 'forbidden') {
    return (
      <Card title="Media server">
        <CardNotice>
          {data === 'forbidden'
            ? 'Calls are available on this server. How the media server itself is doing is for whoever runs it.'
            : available
              ? 'Calls are available on this server.'
              : 'This server has no media server yet — whoever runs it sets one up.'}
        </CardNotice>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card title="Media server">
        <CardNotice>Asking the media server…</CardNotice>
      </Card>
    );
  }

  if (!data.configured) {
    return (
      <Card title="Media server">
        <p className="pref-hint">
          Calls run on LiveKit, an open-source media server this stack starts for you — so
          this message means the server is running without one. Set <code>LIVEKIT_URL</code>{' '}
          (the public <code>wss://</code> address a browser dials, never a container name),{' '}
          <code>LIVEKIT_API_KEY</code> and <code>LIVEKIT_API_SECRET</code>, and point
          LiveKit&rsquo;s webhook at <code>{data.webhookUrl}</code>.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="Media server"
      footer={
        <button className="btn" onClick={reload}>
          Check again
        </button>
      }
    >
      <div className="call-server" data-state={data.reachable ? 'up' : 'down'}>
        <dl className="call-server-facts">
          <dt>Status</dt>
          <dd>
            <span className="call-server-dot" aria-hidden="true" />
            {data.reachable
              ? data.latencyMs === null
                ? 'Answering'
                : `Answering in ${data.latencyMs} ms`
              : data.error === null
                ? 'Not answering'
                : `Not answering — ${data.error}`}
          </dd>
          <dt>Browsers connect to</dt>
          <dd>{data.url}</dd>
          {data.reachable && (
            <>
              <dt>Open now</dt>
              <dd>
                {data.openRooms} {data.openRooms === 1 ? 'call' : 'calls'} open
              </dd>
            </>
          )}
          <dt>Room events</dt>
          <dd>
            {data.lastEventAt
              ? `Last reported ${new Date(data.lastEventAt).toLocaleString()}`
              : `LiveKit has not reported yet. Its webhook should point at ${data.webhookUrl}; until it does, who is in a call updates once a minute.`}
          </dd>
        </dl>
        {/* The one failure nothing above can see. Signalling is a WebSocket and reaches
            LiveKit through the proxy, so this panel reads perfectly healthy while media —
            which is UDP, straight to the host — never arrives: the call connects, shows
            everyone, and is silent. It looks like a bug in Blob, and it is a firewall.
            Said here because this is the page somebody opens when it happens. */}
        {data.reachable && (
          <p className="pref-hint">
            A call that connects but carries no sound is almost always the firewall: media
            is UDP straight to this host, not through the proxy, so LiveKit&rsquo;s UDP port
            has to be open. Everything on this card can look healthy while that one is shut.
          </p>
        )}
      </div>
    </Card>
  );
}
