/**
 * The ••• menu on a message row: copy link, mark unread, save for later, pin, edit,
 * delete. Owns the open state and the panel; edit, the delete confirmation and the
 * clipboard result render at the row level, so those go out as callbacks.
 */

import { useState } from "react";
import type { Message } from "@blob/shared";
import { api } from "../../lib/api.ts";
import { showError } from "../../lib/toasts.ts";
import { useStore } from "../../lib/store.ts";
import { MoreIcon } from "../../components/Icon.tsx";

/** Slack's set, because those are the ones in people's fingers. */
const REMIND_PRESETS: Array<{ label: string; at: () => Date }> = [
  { label: 'In 20 minutes', at: () => new Date(Date.now() + 20 * 60_000) },
  { label: 'In 1 hour', at: () => new Date(Date.now() + 60 * 60_000) },
  { label: 'In 3 hours', at: () => new Date(Date.now() + 3 * 60 * 60_000) },
  {
    label: 'Tomorrow at 9:00',
    at: () => {
      const at = new Date();
      at.setDate(at.getDate() + 1);
      at.setHours(9, 0, 0, 0);
      return at;
    },
  },
  {
    label: 'Next week',
    at: () => {
      const at = new Date();
      at.setDate(at.getDate() + 7);
      at.setHours(9, 0, 0, 0);
      return at;
    },
  },
];

interface Props {
  message: Message;
  /** Edit and delete are offered only on your own messages. */
  mine: boolean;
  onCopyLink: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function MessageMenu({
  message,
  mine,
  onCopyLink,
  onEdit,
  onDelete,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [remindOpen, setRemindOpen] = useState(false);
  const markUnread = useStore((s) => s.markUnread);
  const toggleSaved = useStore((s) => s.toggleSaved);
  // Subscribed to the boolean rather than the Set, so saving one message does not
  // re-render every other row in a channel that is already virtualised for that reason.
  const saved = useStore((s) => s.savedMessageIds.has(message.id));

  return (
    <div style={{ position: "relative" }}>
      <button
        className="message-action"
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        title="More"
        aria-expanded={menuOpen}
      >
        <MoreIcon size={15} />
      </button>
      {menuOpen && (
        /* Reuses the autocomplete popover class, overridden inline to hang below
           the trigger instead of above the composer; a later pass swaps this for a
           shared Menu. */
        <div
          className="autocomplete"
          style={{
            bottom: "auto",
            top: 32,
            left: "auto",
            right: 0,
            width: 160,
          }}
        >
          {/* First, because it is the one people reach for most: a message is
              quoted into another channel or a ticket far more often than it is
              pinned or saved. */}
          <button
            className="autocomplete-item"
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onCopyLink();
            }}
          >
            Copy link
          </button>
          {/* Only in the channel, not in a thread: the read cursor is a channel
              cursor, so marking a reply unread would move a marker pointing at
              something the channel list does not show. */}
          {!message.threadRootId && (
            <button
              className="autocomplete-item"
              type="button"
              onClick={() => {
                setMenuOpen(false);
                void markUnread(message.channelId, message.id).catch(showError);
              }}
            >
              Mark unread
            </button>
          )}
          {/* Above pinning, and worded to draw the line between them: this one
              is yours and tells nobody, pinning is the channel's and tells
              everybody. Slack orders them the same way. */}
          <button
            className="autocomplete-item"
            type="button"
            onClick={() => {
              setMenuOpen(false);
              void toggleSaved(message.id).catch(showError);
            }}
          >
            {saved ? "Remove from later" : "Save for later"}
          </button>
          <button
            className="autocomplete-item"
            type="button"
            aria-expanded={remindOpen}
            onClick={() => setRemindOpen((v) => !v)}
          >
            Remind me…
          </button>
          {remindOpen &&
            REMIND_PRESETS.map((preset) => (
              <button
                key={preset.label}
                className="autocomplete-item remind-preset"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setRemindOpen(false);
                  void api.later
                    .update(message.id, { remindAt: preset.at().toISOString() })
                    .then(() =>
                      useStore.setState((s) => ({
                        savedMessageIds: new Set(s.savedMessageIds).add(message.id),
                      })),
                    )
                    .catch(showError);
                }}
              >
                {preset.label}
              </button>
            ))}
          <button
            className="autocomplete-item"
            type="button"
            onClick={() => {
              setMenuOpen(false);
              void api.messages
                .pin(message.id, message.pinnedAt === null)
                .catch(showError);
            }}
          >
            {message.pinnedAt ? "Unpin" : "Pin to channel"}
          </button>
          {mine && (
            <button
              className="autocomplete-item"
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onEdit();
              }}
            >
              Edit message
            </button>
          )}
          {mine && (
            <button
              className="autocomplete-item"
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
            >
              Delete message
            </button>
          )}
        </div>
      )}
    </div>
  );
}
