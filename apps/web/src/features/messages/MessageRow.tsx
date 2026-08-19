/**
 * One message.
 *
 * Grouping rule: consecutive messages from the same author within 60 seconds share
 * one avatar and header; the exact time then appears in the gutter on hover.
 */

import { useMemo, useState } from 'react';
import type { Message } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { renderMarkdown } from '../../lib/markdown.tsx';
import { Avatar } from '../../components/Avatar.tsx';
import { FileIcon, MoreIcon, ReplyIcon } from '../../components/Icon.tsx';

/** Offered directly in the hover toolbar; the rest come from the picker. */
const QUICK_REACTIONS = ['👍', '🎉', '👀'];

interface Props {
  message: Message;
  previous: Message | null;
  onOpenThread: (rootId: string) => void;
  /** Threads render replies flat, without their own summary line. */
  inThread?: boolean;
}

export function isGrouped(message: Message, previous: Message | null): boolean {
  if (!previous) return false;
  if (previous.authorId !== message.authorId) return false;
  if (previous.deletedAt || message.deletedAt) return false;
  const gap = new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime();
  return gap < 60_000;
}

export function MessageRow({ message, previous, onOpenThread, inThread = false }: Props) {
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const toggleReaction = useStore((s) => s.toggleReaction);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [menuOpen, setMenuOpen] = useState(false);

  const author = message.authorId ? users[message.authorId] : undefined;
  const grouped = isGrouped(message, previous);
  const pending = message.id.startsWith('pending-');
  const mine = message.authorId === currentUser?.id;
  const mentionsMe = currentUser ? message.mentionUserIds.includes(currentUser.id) : false;

  const knownNames = useMemo(
    () => new Map(Object.values(users).map((u) => [u.displayName.toLowerCase(), u.id])),
    [users],
  );

  const rendered = useMemo(
    () => renderMarkdown(message.body, { knownNames, currentUserId: currentUser?.id ?? null }),
    [message.body, knownNames, currentUser],
  );

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
            <span className="message-author">{author?.displayName ?? 'Someone'}</span>
            <time className="message-time" dateTime={message.createdAt}>
              {formatTime(message.createdAt)}
            </time>
            {pending && <span className="message-edited">sending…</span>}
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
            style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}
          >
            <textarea
              className="input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(10, draft.split('\n').length + 1)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setDraft(message.body);
                  setEditing(false);
                }
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
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
            {message.editedAt && <span className="message-edited"> (edited)</span>}
          </div>
        )}

        {message.attachments.length > 0 && (
          <div className="attachments">
            {message.attachments.map((attachment) =>
              attachment.mime.startsWith('image/') ? (
                <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer">
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
                    <span className="attachment-name">{attachment.filename}</span>
                    <span className="attachment-size" style={{ display: 'block' }}>
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
            <span className="link-preview-title">{message.linkPreview.title}</span>
            {message.linkPreview.description && (
              <span className="link-preview-description" style={{ display: 'block' }}>
                {message.linkPreview.description}
              </span>
            )}
          </a>
        )}

        {message.reactions.length > 0 && (
          <div className="reactions">
            {message.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                className="reaction"
                data-mine={currentUser ? reaction.userIds.includes(currentUser.id) : false}
                onClick={() => void toggleReaction(message, reaction.emoji)}
                title={reaction.userIds.map((id) => users[id]?.displayName ?? 'Someone').join(', ')}
              >
                <span>{reaction.emoji}</span>
                <span>{reaction.userIds.length}</span>
              </button>
            ))}
          </div>
        )}

        {!inThread && message.replyCount > 0 && (
          <button className="thread-summary" onClick={() => onOpenThread(message.id)}>
            {message.replyUserIds[0] && <Avatar user={users[message.replyUserIds[0]]} size="sm" />}
            {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
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
              onClick={() => void toggleReaction(message, emoji)}
              title={`React ${emoji}`}
            >
              {emoji}
            </button>
          ))}
          <span className="action-divider" />
          {!inThread && (
            <button
              className="message-action"
              onClick={() => onOpenThread(message.threadRootId ?? message.id)}
              title="Reply in thread"
            >
              <ReplyIcon size={15} />
            </button>
          )}
          <div style={{ position: 'relative' }}>
            <button
              className="message-action"
              onClick={() => setMenuOpen((open) => !open)}
              title="More"
              aria-expanded={menuOpen}
            >
              <MoreIcon size={15} />
            </button>
            {menuOpen && (
              <div className="autocomplete" style={{ bottom: 'auto', top: 32, left: 'auto', right: 0, width: 160 }}>
                <button
                  className="autocomplete-item"
                  onClick={() => {
                    setMenuOpen(false);
                    void api.messages.pin(message.id, message.pinnedAt === null);
                  }}
                >
                  {message.pinnedAt ? 'Unpin' : 'Pin to channel'}
                </button>
                {mine && (
                  <button
                    className="autocomplete-item"
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
                    onClick={() => {
                      setMenuOpen(false);
                      if (confirm('Delete this message?')) void api.messages.remove(message.id);
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
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatRelative(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
