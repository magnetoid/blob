/**
 * One message.
 *
 * Grouping rule: consecutive messages from the same author within 60 seconds share
 * one avatar and header; the exact time then appears in the gutter on hover.
 */

import { useEffect, useMemo, useRef, useState, memo } from "react";
import type { CustomEmoji, Message } from "@blob/shared";
import { api } from "../../lib/api.ts";
import { showError } from "../../lib/toasts.ts";
import { useStore } from "../../lib/store.ts";
import { permalinkFor } from "../../lib/navigation.ts";
import { useMentionIndex } from "./mentionIndex.ts";
import type { LocalMessageDeliveryStatus } from "../../lib/outbox.ts";
import { renderMarkdown } from "../../lib/markdown.tsx";
import { BlockRenderer } from "./BlockRenderer.tsx";
import { MessageEditor } from "./MessageEditor.tsx";
import { MessageMenu } from "./MessageMenu.tsx";
import { ForwardDialog } from "./ForwardDialog.tsx";
import { moveFocusBetweenMessages } from "./arrowNavigation.ts";
import { MessageTranslation } from "./MessageTranslation.tsx";
import { formatRelative, formatTime } from "./messageFormatting.ts";
import { Avatar } from "../../components/Avatar.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { EmojiPicker } from "../../components/EmojiPicker.tsx";
import { FileIcon, ReplyIcon } from "../../components/Icon.tsx";
import { resolveReaction } from "../../lib/emoji.ts";

/** Offered directly in the hover toolbar; the rest come from the picker. */
const QUICK_REACTIONS = ["👍", "🎉", "👀"];

interface Props {
  message: Message;
  previous: Message | null;
  onOpenThread: (rootId: string) => void;
  /** Threads render replies flat, without their own summary line. */
  inThread?: boolean;
  /**
   * Whether this row is the list's single tab stop.
   *
   * A roving tabindex, and the list is why it has to be one. Every row carried
   * `tabIndex={0}` and so did each of its six actions, so Tab walked seven stops per
   * message and focusing an off-screen row scrolled it into view, which rendered more
   * rows to walk — there was no number of presses that got from the conversation to the
   * composer. Arrows move between rows; Tab enters this row's actions and then leaves.
   */
  isTabStop?: boolean;
  /** Told when this row takes focus, so the list can move the tab stop to it. */
  onFocusRow?: (messageId: string) => void;
}

/**
 * A reaction's face.
 *
 * Unicode reactions are stored as the character, custom ones as `:name:`. A shortcode
 * whose emoji has since been deleted falls back to the raw text rather than to a broken
 * image — the reaction still counts, it just stops having a picture.
 */
function ReactionFace({
  value,
  custom,
}: {
  value: string;
  custom: readonly CustomEmoji[];
}) {
  const resolved = resolveReaction(value, custom);
  if (resolved?.kind === "custom") {
    return (
      <img
        className="custom-emoji"
        src={resolved.url}
        alt={`:${resolved.name}:`}
        loading="lazy"
      />
    );
  }
  return <>{resolved?.char ?? value}</>;
}

function isGrouped(message: Message, previous: Message | null): boolean {
  if (!previous) return false;
  if (previous.authorId !== message.authorId) return false;
  if (previous.deletedAt || message.deletedAt) return false;
  const gap =
    new Date(message.createdAt).getTime() -
    new Date(previous.createdAt).getTime();
  return gap < 60_000;
}

export const MessageRow = memo(function MessageRow({
  message,
  previous,
  onOpenThread,
  inThread = false,
  isTabStop = true,
  onFocusRow,
}: Props) {
  // -1 keeps a row reachable by script and by the arrow handler while taking it out of
  // the sequential order. The actions follow the row: a button inside a `tabIndex={-1}`
  // element is still tabbable on its own, so they have to be told separately.
  const tab = isTabStop ? 0 : -1;
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const customEmoji = useStore((s) => s.customEmoji);
  const toggleReaction = useStore((s) => s.toggleReaction);
  const myGroupIds = useStore((s) => s.myGroupIds);
  const knownNames = useMentionIndex();
  const [copied, setCopied] = useState(false);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);

  // Clears itself. A confirmation that stays is indistinguishable from a stuck one, and
  // this row can live for as long as the channel is open.
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  const retryQueuedMessage = useStore((s) => s.retryQueuedMessage);
  const discardQueuedMessage = useStore((s) => s.discardQueuedMessage);
  const deliveryState = useStore((s) => s.messageDeliveryState(message));

  // Editing lives in the store, not here: ↑ from an empty composer opens the last
  // message, and the composer cannot reach a sibling row's local state. At most one
  // message is open at a time, which one id says and a boolean per row does not.
  const editingMessageId = useStore((s) => s.editingMessageId);
  const setEditingMessage = useStore((s) => s.setEditingMessage);
  const editing = editingMessageId === message.id;
  const setEditing = (open: boolean) =>
    setEditingMessage(open ? message.id : null);
  const [deleting, setDeleting] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const author = message.authorId ? users[message.authorId] : undefined;
  const grouped = isGrouped(message, previous);
  const pending = deliveryState !== null || message.id.startsWith("pending-");
  const mine = message.authorId === currentUser?.id;
  // Being named as part of a team you are on is being named. The author check is a
  // deliberate change: `notify.decide` has always skipped the author, so a message that
  // mentioned you *and was yours* notified nobody while still drawing the accent bar.
  // Group mentions make that disagreement the common case — every "@platform-team
  // standup in 5" posted by somebody on that team.
  const mentionsMe =
    currentUser !== null &&
    message.authorId !== currentUser.id &&
    (message.mentionUserIds.includes(currentUser.id) ||
      message.mentionGroupIds.some((id) => myGroupIds.has(id)));

  const rendered = useMemo(
    () =>
      renderMarkdown(message.body, {
        knownNames,
        currentUserId: currentUser?.id ?? null,
        customEmoji,
      }),
    [message.body, knownNames, currentUser, customEmoji],
  );

  // Same dismissal contract as the account menu: any click outside, or Escape. Capture
  // phase, so opening another row's picker closes this one rather than leaving two open.
  useEffect(() => {
    if (!pickerOpen) return undefined;
    const onClick = (event: MouseEvent) => {
      if (pickerRef.current?.contains(event.target as Node)) return;
      setPickerOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPickerOpen(false);
    };
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);

  // `navigator.clipboard` needs a secure context, so on plain http over a LAN this
  // falls back to showing the URL for somebody to copy by hand rather than failing
  // silently.
  const copyLink = () => {
    const url = permalinkFor(message.id);
    void navigator.clipboard?.writeText(url).then(
      () => setCopied(true),
      () => setCopyFallback(url),
    );
  };

  if (message.deletedAt) {
    return (
      <div className="message" data-grouped={grouped}>
        <div className="message-gutter" />
        <div className="message-main">
          <div className="message-deleted">This message was deleted</div>
        </div>
      </div>
    );
  }

  return (
    // Both rules object to the same deliberate decision, made once: this row is a
    // focusable, keyboard-driven element even though ARIA has no role for "an article
    // in a log that you arrow through". The alternative — role="option" — would be a
    // lie about the list, which is a `log` because it is a live feed.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <article
      className="message"
      // Focusable so the hover toolbar is reachable without a mouse: the reveal rule
      // is :focus-within, and a plain-text message contains nothing focusable — so
      // without a tab stop on the row itself, react/reply/menu simply did not exist
      // for a keyboard user. The lint rule guards against *meaningless* tab stops;
      // this one is the only route to three actions.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={tab}
      onFocus={(event) => {
        // Only the row itself, not a button inside it bubbling up — otherwise clicking
        // an action would re-anchor the tab stop mid-interaction.
        if (event.target === event.currentTarget) onFocusRow?.(message.id);
      }}
      // The anchor the pinned panel jumps to. An attribute rather than an `id`, because
      // the same message can render in the list and in a thread at once and duplicate
      // ids would make `getElementById` pick whichever the DOM happened to hold first.
      data-message-id={message.id}
      data-grouped={grouped}
      data-starts-group={!grouped && previous !== null}
      data-mentions-me={mentionsMe}
      data-pending={pending}
      data-delivery-state={deliveryState ?? undefined}
      onKeyDown={moveFocusBetweenMessages}
    >
      <div className="message-gutter">
        {grouped ? (
          <time className="gutter-time" dateTime={message.createdAt}>
            {formatTime(message.createdAt)}
          </time>
        ) : (
          <Avatar user={author} size="lg" />
        )}
      </div>

      <div className="message-main">
        {!grouped && (
          <div className="message-head">
            <span className="message-author">
              {author?.displayName ?? "Someone"}
            </span>
            <time className="message-time" dateTime={message.createdAt}>
              {formatTime(message.createdAt)}
            </time>
            {deliveryState && (
              <span className="message-edited">
                {deliveryStatusLabel(deliveryState)}
              </span>
            )}
          </div>
        )}

        {editing ? (
          <MessageEditor message={message} onClose={() => setEditing(false)} />
        ) : (
          <div className="message-body">
            {rendered}
            {message.editedAt && (
              <span className="message-edited"> (edited)</span>
            )}
          </div>
        )}

        {message.blocks && message.blocks.length > 0 && (
          <BlockRenderer
            messageId={message.id}
            blocks={message.blocks}
            options={{
              knownNames,
              currentUserId: currentUser?.id ?? null,
              customEmoji,
            }}
          />
        )}

        {message.attachments.length > 0 && (
          <div className="attachments">
            {message.attachments.map((attachment) =>
              attachment.mime.startsWith("image/") ? (
                <a
                  key={attachment.id}
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    className="attachment-image"
                    src={attachment.thumbUrl ?? attachment.url}
                    alt={attachment.filename}
                  />
                </a>
              ) : (
                <a
                  key={attachment.id}
                  className="attachment-file"
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="attachment-icon">
                    <FileIcon size="md" />
                  </span>
                  <span>
                    <span className="attachment-name">
                      {attachment.filename}
                    </span>
                    <span
                      className="attachment-size"
                      style={{ display: "block" }}
                    >
                      {formatSize(attachment.sizeBytes)}
                    </span>
                  </span>
                </a>
              ),
            )}
          </div>
        )}

        {message.linkPreview?.title && (
          <a
            className="link-preview"
            href={message.linkPreview.url}
            target="_blank"
            rel="noreferrer"
          >
            <span className="link-preview-title">
              {message.linkPreview.title}
            </span>
            {message.linkPreview.description && (
              <span
                className="link-preview-description"
                style={{ display: "block" }}
              >
                {message.linkPreview.description}
              </span>
            )}
          </a>
        )}

        <MessageTranslation
          message={message}
          pending={pending}
          editing={editing}
        />

        {deliveryState && (
          <div className="message-delivery" data-state={deliveryState}>
            <span>{deliveryStatusHint(deliveryState)}</span>
            {deliveryState === "failed" && (
              <>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => void retryQueuedMessage(message.clientMsgId)}
                >
                  Retry
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => discardQueuedMessage(message.clientMsgId)}
                >
                  Discard
                </button>
              </>
            )}
          </div>
        )}

        {message.reactions.length > 0 && (
          <div className="reactions">
            {message.reactions.map((reaction) => {
              const mine = currentUser
                ? reaction.userIds.includes(currentUser.id)
                : false;
              return (
                <button
                  key={reaction.emoji}
                  className="reaction"
                  // `data-mine` styles it; `aria-pressed` is the same fact said out loud.
                  // A chip is a toggle, and whether you are already in it decides what
                  // clicking does — so a reader who cannot see the highlight has no way to
                  // know whether they are about to react or take their reaction back.
                  data-mine={mine}
                  aria-pressed={mine}
                  type="button"
                  onClick={() =>
                    void toggleReaction(message, reaction.emoji).catch(
                      showError,
                    )
                  }
                  title={reaction.userIds
                    .map((id) => users[id]?.displayName ?? "Someone")
                    .join(", ")}
                >
                  <span>
                    <ReactionFace value={reaction.emoji} custom={customEmoji} />
                  </span>
                  <span>{reaction.userIds.length}</span>
                </button>
              );
            })}
          </div>
        )}

        {!inThread && message.replyCount > 0 && (
          <button
            className="thread-summary"
            type="button"
            onClick={() => onOpenThread(message.id)}
          >
            {message.replyUserIds[0] && (
              <Avatar user={users[message.replyUserIds[0]]} size="sm" />
            )}
            {message.replyCount}{" "}
            {message.replyCount === 1 ? "reply" : "replies"}
            {message.lastReplyAt && (
              <span className="thread-summary-meta">
                Last reply {formatRelative(message.lastReplyAt)}
              </span>
            )}
          </button>
        )}
      </div>

      {!pending && !editing && (
        <div className="message-actions">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              className="message-action"
              data-emoji="true"
              type="button"
              tabIndex={tab}
              onClick={() =>
                void toggleReaction(message, emoji).catch(showError)
              }
              aria-label={`React ${emoji}`}
              data-tooltip={`React ${emoji}`}
              data-tooltip-place="top"
            >
              {emoji}
            </button>
          ))}
          <div className="emoji-picker-anchor" ref={pickerRef}>
            <button
              className="message-action"
              data-emoji="true"
              type="button"
              tabIndex={tab}
              aria-expanded={pickerOpen}
              aria-haspopup="dialog"
              onClick={() => setPickerOpen((value) => !value)}
              aria-label="Add reaction"
              data-tooltip="Add reaction"
              data-tooltip-place="top"
            >
              ＋
            </button>
            {pickerOpen && (
              <EmojiPicker
                label="React with an emoji"
                onClose={() => setPickerOpen(false)}
                onPick={(value) => {
                  setPickerOpen(false);
                  void toggleReaction(message, value).catch(showError);
                }}
              />
            )}
          </div>
          <span className="action-divider" />
          {!inThread && (
            <button
              className="message-action"
              type="button"
              tabIndex={tab}
              onClick={() => onOpenThread(message.threadRootId ?? message.id)}
              aria-label="Reply in thread"
              data-tooltip="Reply in thread"
              data-tooltip-place="top"
            >
              <ReplyIcon size="md" />
            </button>
          )}
          {copied && (
            <span className="copied-note" role="status">
              Link copied
            </span>
          )}
          <MessageMenu
            message={message}
            mine={mine}
            tabIndex={tab}
            onCopyLink={copyLink}
            onForward={() => setForwarding(true)}
            onEdit={() => setEditing(true)}
            onDelete={() => setDeleting(true)}
          />
        </div>
      )}

      {/* At the article level, not inside the menu: `.message-actions` is
          display:none unless the row is hovered or has focus within, and a dialog
          opened from the keyboard must not depend on where the pointer sits. */}
      {forwarding && (
        <ForwardDialog message={message} onClose={() => setForwarding(false)} />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete this message?"
          body="It disappears for everyone. There is no undo."
          confirmLabel="Delete"
          danger
          onClose={() => setDeleting(false)}
          onConfirm={() => {
            setDeleting(false);
            void api.messages.remove(message.id).catch(showError);
          }}
        />
      )}

      {/* No clipboard API: a secure context is required, and a self-hosted workspace
          reached over plain http on a LAN does not have one. Showing the link to copy
          by hand is the honest fallback — the alternative is a menu item that silently
          does nothing on exactly the deployments this project is built for. */}
      {copyFallback && (
        <div className="copy-fallback">
          <label className="field" style={{ margin: 0 }}>
            <span className="field-label">Copy this link</span>
            <input
              className="input"
              readOnly
              value={copyFallback}
              onFocus={(event) => event.currentTarget.select()}
              /* eslint-disable-next-line jsx-a11y/no-autofocus -- it exists to be
                 selected; anything else is a step the person did not ask for. */
              autoFocus
            />
          </label>
          <button className="btn" onClick={() => setCopyFallback(null)}>
            Done
          </button>
        </div>
      )}
    </article>
  );
});

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function deliveryStatusLabel(status: LocalMessageDeliveryStatus): string {
  switch (status) {
    case "sending":
      return "sending…";
    case "queued":
      return "queued";
    case "failed":
      return "needs attention";
  }
}

function deliveryStatusHint(status: LocalMessageDeliveryStatus): string {
  switch (status) {
    case "sending":
      return "Sending now.";
    case "queued":
      return "Queued to send when your connection is back.";
    case "failed":
      return "That send was rejected. Retry it or discard this draft.";
  }
}
