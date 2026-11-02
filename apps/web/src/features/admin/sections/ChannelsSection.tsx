/** Every channel, including the private ones an admin is not in. */

import { useCallback, useEffect, useState } from "react";
import { api, type AdminChannel } from "../../../lib/api.ts";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { DialogPresence } from "../../../components/Dialog.tsx";
import { formatRelative } from "../../messages/messageFormatting.ts";
import { Badge } from "../../../components/ui/badge.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { ItemActions, ItemContent, ItemDescription, ItemTitle } from "../../../components/ui/item.tsx";
import { Card, CardNotice, CardRow, CardRows } from "../../console/Card.tsx";
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
    <div className="flex flex-col gap-6">
      <Card>
        {channels === null ? (
          <CardNotice>Loading…</CardNotice>
        ) : channels.length === 0 ? (
          <CardNotice>No channels yet.</CardNotice>
        ) : (
          <CardRows>
            {channels.map((channel) => (
              <CardRow key={channel.id}>
                <ItemContent>
                  {/* A closed channel's name goes grey and its badge says why, rather than
                      the whole row being dimmed, which took its meta line below readable. */}
                  <ItemTitle className={channel.archivedAt ? "text-muted-foreground" : undefined}>
                    {channel.name ? `#${channel.name}` : "Direct message"}
                    {channel.kind !== "public" && <Badge variant="outline">{channel.kind}</Badge>}
                    {channel.archivedAt && <Badge variant="secondary">archived</Badge>}
                  </ItemTitle>
                  <ItemDescription>
                    {channel.memberCount} members · {channel.messageCount} messages
                    {channel.lastMessageAt
                      ? ` · active ${formatRelative(channel.lastMessageAt)}`
                      : " · never used"}
                  </ItemDescription>
                </ItemContent>
                {channel.kind !== "dm" && channel.kind !== "group_dm" && (
                  <ItemActions>
                    {channel.archivedAt ? (
                      // Archiving used to be permanent by omission: nothing anywhere set
                      // `archived_at` back to null, so a channel closed by mistake stayed
                      // closed and its history stayed readable but unwritable for ever.
                      <Button
                        variant="outline"
                        aria-label={`Reopen #${channel.name}`}
                        onClick={() => void act(() => api.admin.unarchiveChannel(channel.id))}
                      >
                        Reopen
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        aria-label={`Archive #${channel.name}`}
                        onClick={() => setArchiving(channel)}
                      >
                        Archive
                      </Button>
                    )}
                  </ItemActions>
                )}
              </CardRow>
            ))}
          </CardRows>
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
