/**
 * The ••• menu on a message row: copy link, mark unread, save for later, pin, edit,
 * delete. The menu itself is `MessageMenuPanel`, fetched on its own and drawn on the first
 * press (`lazyPopups.ts`); what is here is its trigger, which the first paint needs, and the
 * two dialogs its items open that are the menu's own — Record a decision and Earlier
 * versions — since a dialog outlives the menu that opened it. Edit, the delete
 * confirmation, Forward, Start work and the clipboard result render at the row level, so
 * those go out as callbacks.
 *
 * When one of these dialogs ends, focus goes to the message's row. The item it was opened
 * from is gone, and More actions sits in a toolbar that is `visibility: hidden` unless the
 * row is hovered or holds focus — which, with focus in the dialog and the pointer over it,
 * it does not — so focus sent back to the button would land on <body>.
 */

import { useRef, useState } from "react";
import type { Message } from "@blob/shared";
import { api } from "../../lib/api.ts";
import { MoreIcon } from "../../components/Icon.tsx";
import { DialogPresence } from "../../components/Dialog.tsx";
import { DecisionDialog } from "../decisions/DecisionDialog.tsx";
import { VersionsDialog } from "./VersionsDialog.tsx";
import { firstDraft } from "../decisions/decisionText.ts";
import { MessageMenuPopup } from "./lazyPopups.ts";

interface Props {
  message: Message;
  /** Edit and delete are offered only on your own messages. */
  mine: boolean;
  onCopyLink: () => void;
  onForward: () => void;
  /** Absent inside a work channel, where the work already is. */
  onStartWork?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Follows the row's roving tabindex: only the list's one tab stop is tabbable. */
  tabIndex?: number;
}

export function MessageMenu({
  message,
  mine,
  onCopyLink,
  onForward,
  onStartWork,
  onEdit,
  onDelete,
  tabIndex,
}: Props) {
  const [deciding, setDeciding] = useState(false);
  const [versions, setVersions] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  /** The message's row, which a dialog from the menu gives focus back to. */
  const row = () => button.current?.closest<HTMLElement>("article[data-message-id]") ?? null;

  return (
    <>
      <MessageMenuPopup
        trigger={
          <button
            ref={button}
            className="message-action"
            type="button"
            tabIndex={tabIndex}
            aria-label="More actions"
            data-tooltip="More"
            data-tooltip-place="top"
          >
            <MoreIcon size="md" />
          </button>
        }
        message={message}
        mine={mine}
        onCopyLink={onCopyLink}
        onForward={onForward}
        onStartWork={onStartWork}
        onEdit={onEdit}
        onDelete={onDelete}
        onRecordDecision={() => setDeciding(true)}
        onEarlierVersions={() => setVersions(true)}
      />
      <DialogPresence when={versions ? message : null} returnFocus={row}>
        {(source) => (
          <VersionsDialog
            messageId={source.id}
            current={source.body}
            onClose={() => setVersions(false)}
          />
        )}
      </DialogPresence>
      <DialogPresence when={deciding ? message : null} returnFocus={row}>
        {(source) => (
          <DecisionDialog
            heading="Record a decision"
            initialTitle={firstDraft(source.body)}
            saveLabel="Record"
            onSave={(title, rationale, clientId) =>
              api.decisions.record(source.channelId, {
                title,
                rationale: rationale || undefined,
                messageId: source.id,
                clientId,
              })
            }
            onClose={() => setDeciding(false)}
          />
        )}
      </DialogPresence>
    </>
  );
}
