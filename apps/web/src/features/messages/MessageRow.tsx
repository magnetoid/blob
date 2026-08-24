/**
 * One message.
 *
 * Grouping rule: consecutive messages from the same author within 60 seconds share
 * one avatar and header; the exact time then appears in the gutter on hover.
 */

import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import type { CustomEmoji, Message, MessageTranslation } from "@blob/shared";
import { ApiError, api } from "../../lib/api.ts";
import { useStore } from "../../lib/store.ts";
import type { LocalMessageDeliveryStatus } from "../../lib/outbox.ts";
import { renderMarkdown } from "../../lib/markdown.tsx";
import { BlockRenderer } from "./BlockRenderer.tsx";
import { formatRelative, formatTime } from "./messageFormatting.ts";
import { Avatar } from "../../components/Avatar.tsx";
import { EmojiPicker } from "../../components/EmojiPicker.tsx";
import { FileIcon, MoreIcon, ReplyIcon } from "../../components/Icon.tsx";
import { resolveReaction } from "../../lib/emoji.ts";

/** Offered directly in the hover toolbar; the rest come from the picker. */
const QUICK_REACTIONS = ["👍", "🎉", "👀"];

interface Props {
  message: Message;
  previous: Message | null;
  onOpenThread: (rootId: string) => void;
  /** Threads render replies flat, without their own summary line. */
  inThread?: boolean;
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

const translationCache = new Map<string, MessageTranslation>();

function translationCacheKey(message: Message, targetLanguage: string): string {
  return `${message.id}:${message.editedAt ?? message.createdAt}:${targetLanguage}`;
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
}: Props) {
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const customEmoji = useStore((s) => s.customEmoji);
  const toggleReaction = useStore((s) => s.toggleReaction);
  const retryQueuedMessage = useStore((s) => s.retryQueuedMessage);
  const discardQueuedMessage = useStore((s) => s.discardQueuedMessage);
  const deliveryState = useStore((s) => s.messageDeliveryState(message));

  // Editing lives in the store, not here: ↑ from an empty composer opens the last
  // message, and the composer cannot reach a sibling row's local state. At most one
  // message is open at a time, which one id says and a boolean per row does not.
  const editingMessageId = useStore((s) => s.editingMessageId);
  const setEditingMessage = useStore((s) => s.setEditingMessage);
  const editing = editingMessageId === message.id;
  const setEditing = (open: boolean) => setEditingMessage(open ? message.id : null);
  const [draft, setDraft] = useState(message.body);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const preferredLanguage = currentUser?.prefs.language ?? null;
  const autoTranslate = Boolean(
    currentUser?.prefs.autoTranslate && preferredLanguage,
  );
  const [translation, setTranslation] = useState<MessageTranslation | null>(
    null,
  );
  const [translationBusy, setTranslationBusy] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [translationVisible, setTranslationVisible] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

  const author = message.authorId ? users[message.authorId] : undefined;
  const grouped = isGrouped(message, previous);
  const pending = deliveryState !== null || message.id.startsWith("pending-");
  const mine = message.authorId === currentUser?.id;
  const mentionsMe = currentUser
    ? message.mentionUserIds.includes(currentUser.id)
    : false;
  const canTranslate =
    !pending &&
    !editing &&
    !message.deletedAt &&
    !!message.body.trim() &&
    !!preferredLanguage;

  const knownNames = useMemo(
    () =>
      new Map(
        Object.values(users).map((u) => [u.displayName.toLowerCase(), u.id]),
      ),
    [users],
  );

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

  useEffect(() => {
    if (!preferredLanguage) {
      setTranslation(null);
      setTranslationVisible(false);
      setTranslationError(null);
      return;
    }
    const cached =
      translationCache.get(translationCacheKey(message, preferredLanguage)) ??
      null;
    setTranslation(cached);
    setTranslationVisible((current) =>
      cached !== null ? autoTranslate || current : false,
    );
    setTranslationError(null);
  }, [autoTranslate, message, preferredLanguage]);

  const requestTranslation = useCallback(
    async (forceRefresh = false) => {
      if (!preferredLanguage || !canTranslate) return;
      setTranslationBusy(true);
      setTranslationError(null);
      try {
        const { translation: next } = await api.messages.translate(message.id, {
          targetLanguage: preferredLanguage,
          forceRefresh,
        });
        translationCache.set(
          translationCacheKey(message, preferredLanguage),
          next,
        );
        setTranslation(next);
        setTranslationVisible(true);
      } catch (error) {
        const nextError =
          error instanceof ApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : "That translation couldn't be loaded.";
        setTranslationError(nextError);
      } finally {
        setTranslationBusy(false);
      }
    },
    [canTranslate, message, preferredLanguage],
  );

  useEffect(() => {
    if (
      !autoTranslate ||
      !canTranslate ||
      mine ||
      translation ||
      translationBusy
    )
      return;
    void requestTranslation();
  }, [
    autoTranslate,
    canTranslate,
    mine,
    requestTranslation,
    translation,
    translationBusy,
  ]);

  useEffect(() => {
    if (!editing) return;
    // Seeded here rather than only at mount. Editing can now be opened by ↑ from the
    // composer, long after this row rendered, and `useState(message.body)` would hand
    // back whatever the body was then — so an edit made in between would be undone by
    // saving a stale draft.
    setDraft(message.body);
    editRef.current?.focus();
  }, [editing, message.body]);

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
    <article
      className="message"
      data-grouped={grouped}
      data-starts-group={!grouped && previous !== null}
      data-mentions-me={mentionsMe}
      data-pending={pending}
      data-delivery-state={deliveryState ?? undefined}
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
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const trimmed = draft.trim();
              if (!trimmed) return;
              await api.messages.edit(message.id, trimmed);
              setEditing(false);
            }}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              marginTop: 4,
            }}
          >
            <textarea
              ref={editRef}
              className="input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(10, draft.split("\n").length + 1)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setDraft(message.body);
                  setEditing(false);
                }
              }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" type="submit">
                Save
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setDraft(message.body);
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
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
                    <FileIcon size={15} />
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

        {canTranslate && (
          <div className="message-translation-actions">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                if (translation) {
                  setTranslationVisible((visible) => !visible);
                  return;
                }
                void requestTranslation();
              }}
              disabled={translationBusy}
            >
              {translationBusy
                ? "Translating…"
                : translationVisible
                  ? "Hide translation"
                  : translation
                    ? "Show translation"
                    : "Translate"}
            </button>
            {translation && (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => void requestTranslation(true)}
                disabled={translationBusy}
              >
                Refresh
              </button>
            )}
            {translationError && (
              <span className="message-translation-error">
                {translationError}
              </span>
            )}
          </div>
        )}

        {translationVisible && translation && (
          <div className="message-translation-card">
            <div className="message-translation-meta">
              {translation.sourceLanguage
                ? `Translated from ${displayLanguage(translation.sourceLanguage)} to ${displayLanguage(translation.targetLanguage)}`
                : `Translated to ${displayLanguage(translation.targetLanguage)}`}
              {" · "}
              {translation.provider}
            </div>
            <div className="message-translation-text">
              {translation.translatedText}
            </div>
          </div>
        )}

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
            {message.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                className="reaction"
                data-mine={
                  currentUser
                    ? reaction.userIds.includes(currentUser.id)
                    : false
                }
                type="button"
                onClick={() => void toggleReaction(message, reaction.emoji)}
                title={reaction.userIds
                  .map((id) => users[id]?.displayName ?? "Someone")
                  .join(", ")}
              >
                <span>
                  <ReactionFace value={reaction.emoji} custom={customEmoji} />
                </span>
                <span>{reaction.userIds.length}</span>
              </button>
            ))}
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
              onClick={() => void toggleReaction(message, emoji)}
              title={`React ${emoji}`}
            >
              {emoji}
            </button>
          ))}
          <div className="emoji-picker-anchor" ref={pickerRef}>
            <button
              className="message-action"
              data-emoji="true"
              type="button"
              aria-expanded={pickerOpen}
              aria-haspopup="dialog"
              onClick={() => setPickerOpen((value) => !value)}
              title="Add reaction"
            >
              ＋
            </button>
            {pickerOpen && (
              <EmojiPicker
                label="React with an emoji"
                onClose={() => setPickerOpen(false)}
                onPick={(value) => {
                  setPickerOpen(false);
                  void toggleReaction(message, value);
                }}
              />
            )}
          </div>
          <span className="action-divider" />
          {!inThread && (
            <button
              className="message-action"
              type="button"
              onClick={() => onOpenThread(message.threadRootId ?? message.id)}
              title="Reply in thread"
            >
              <ReplyIcon size={15} />
            </button>
          )}
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
                <button
                  className="autocomplete-item"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void api.messages.pin(
                      message.id,
                      message.pinnedAt === null,
                    );
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
                      setEditing(true);
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
                      if (confirm("Delete this message?"))
                        void api.messages.remove(message.id);
                    }}
                  >
                    Delete message
                  </button>
                )}
              </div>
            )}
          </div>
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

function displayLanguage(code: string): string {
  try {
    const display = new Intl.DisplayNames(undefined, { type: "language" }).of(
      code,
    );
    return display ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}
