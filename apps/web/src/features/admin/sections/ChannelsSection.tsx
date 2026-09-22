/** Every channel, including the private ones an admin is not in. */

import { useCallback, useEffect, useState } from "react";
import { api, type AdminChannel } from "../../../lib/api.ts";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { DialogPresence } from "../../../components/Dialog.tsx";
import { formatRelative } from "../../messages/messageFormatting.ts";
import { Card, CardNotice } from "../../console/Card.tsx";
import { useAdminAction } from '../../console/hooks.ts';

export function ChannelsSection({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  // Null until the first answer, so the card can say it is loading rather than show an
  // empty list for a moment — and `failed` for when that answer was an error, which the
  // null alone cannot tell from a request still on its way.
  const [channels, setChannels] = useState<AdminChannel[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [archiving, setArchiving] = useState<AdminChannel | null>(null);

  const load = useCallback(() => {
    void api.admin
      .channels()
      .then((r) => {
        setChannels(r.channels);
        setFailed(false);
      })
      .catch(() => {
        setFailed(true);
        onError("Could not load channels.");
      });
  }, [onError]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);
  const act = useAdminAction(onError, load);

  // A list that could not be read draws no card. The error above is what the page has to
  // say; "Loading…" would never end, and "No channels yet." would be a claim about
  // channels it never saw.
  if (channels === null && failed) return null;

  return (
    <div className="console-stack">
      <Card>
        {channels === null ? (
          <CardNotice>Loading…</CardNotice>
        ) : channels.length === 0 ? (
          <CardNotice>No channels yet.</CardNotice>
        ) : (
          <div className="console-list">
            {channels.map((channel) => (
              <div
                className="admin-row"
                key={channel.id}
                data-inactive={channel.archivedAt !== null}
              >
                <div className="grow min-0">
                  <div className="admin-row-title">
                    {channel.name ? `#${channel.name}` : "Direct message"}
                    {channel.kind !== "public" && (
                      <span className="role-pill">{channel.kind}</span>
                    )}
                    {channel.archivedAt && (
                      <span className="role-pill" data-muted>
                        archived
                      </span>
                    )}
                  </div>
                  <div className="admin-row-meta">
                    {channel.memberCount} members · {channel.messageCount} messages
                    {channel.lastMessageAt
                      ? ` · active ${formatRelative(channel.lastMessageAt)}`
                      : " · never used"}
                  </div>
                </div>
                {channel.kind !== "dm" &&
                  channel.kind !== "group_dm" &&
                  (channel.archivedAt ? (
                    // Archiving used to be permanent by omission: nothing anywhere set
                    // `archived_at` back to null, so a channel closed by mistake stayed
                    // closed and its history stayed readable but unwritable for ever.
                    <button
                      className="btn"
                      aria-label={`Reopen #${channel.name}`}
                      onClick={() => void act(() => api.admin.unarchiveChannel(channel.id))}
                    >
                      Reopen
                    </button>
                  ) : (
                    <button
                      className="btn"
                      aria-label={`Archive #${channel.name}`}
                      onClick={() => setArchiving(channel)}
                    >
                      Archive
                    </button>
                  ))}
              </div>
            ))}
          </div>
        )}
      </Card>

      <DialogPresence when={archiving}>
        {(archiving) => (
          <ConfirmDialog
            title={`Archive #${archiving.name}?`}
            body="It stays searchable and readable, but nobody can post in it again."
            confirmLabel="Archive"
            onClose={() => setArchiving(null)}
            onConfirm={() => {
              const channel = archiving;
              setArchiving(null);
              void act(() => api.admin.archiveChannel(channel.id));
            }}
          />
        )}
      </DialogPresence>
    </div>
  );
}
