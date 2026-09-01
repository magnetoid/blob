/** Every channel, including the private ones an admin is not in. */

import { useCallback, useEffect, useState } from "react";
import { api, type AdminChannel } from "../../../lib/api.ts";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { formatRelative } from "../../messages/messageFormatting.ts";
import { useAdminAction } from "../hooks.ts";

export function ChannelsSection({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const [channels, setChannels] = useState<AdminChannel[]>([]);
  const [archiving, setArchiving] = useState<AdminChannel | null>(null);

  const load = useCallback(() => {
    void api.admin
      .channels()
      .then((r) => setChannels(r.channels))
      .catch(() => onError("Could not load channels."));
  }, [onError]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);
  const act = useAdminAction(onError, load);

  return (
    <section className="admin-table">
      {channels.map((channel) => (
        <div
          className="admin-row"
          key={channel.id}
          data-inactive={channel.archivedAt !== null}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
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
          {!channel.archivedAt &&
            channel.kind !== "dm" &&
            channel.kind !== "group_dm" && (
              <button
                className="btn"
                aria-label={`Archive #${channel.name}`}
                onClick={() => setArchiving(channel)}
              >
                Archive
              </button>
            )}
        </div>
      ))}

      {archiving && (
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
    </section>
  );
}
