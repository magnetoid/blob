/**
 * The composer.
 *
 * Enter sends, Shift+Enter breaks the line (invertible in preferences). `@` opens
 * mention autocomplete against the same name index the server uses to resolve
 * mentions, so what highlights here is exactly what notifies there.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useStore } from '../../lib/store.ts';
import { socket } from '../../lib/socket.ts';
import { Avatar } from '../../components/Avatar.tsx';
import { AttachIcon, EmojiIcon, MentionIcon, SendIcon } from '../../components/Icon.tsx';

const EMOJI_PICKS = ['👍', '🎉', '👀', '✅', '🙏', '🔥', '😄', '❤️'];

interface Props {
  channelId: string;
  threadRootId?: string | null;
  placeholder: string;
  autoFocus?: boolean;
}

export function Composer({ channelId, threadRootId = null, placeholder, autoFocus }: Props) {
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const sendMessage = useStore((s) => s.sendMessage);
  const enterToSend = useStore((s) => s.currentUser?.prefs.enterToSend ?? true);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingRef = useRef(0);

  // Grow with content rather than scrolling a fixed two-line box.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [draft]);

  const candidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    const people = Object.values(users)
      .filter((u) => !u.deactivated && u.id !== currentUser?.id)
      .filter((u) => u.displayName.toLowerCase().includes(q))
      .slice(0, 6);
    const specials = ['channel', 'here'].filter((s) => s.startsWith(q));
    return [
      ...specials.map((name) => ({ id: `@${name}`, displayName: name, avatarUrl: null })),
      ...people,
    ];
  }, [mentionQuery, users, currentUser]);

  function updateDraft(value: string) {
    setDraft(value);
    setError(null);

    // Track a trailing `@word` to drive the autocomplete.
    const match = value.slice(0, textareaRef.current?.selectionStart ?? value.length).match(/@([\p{L}\p{N}._'-]*)$/u);
    setMentionQuery(match ? (match[1] ?? '') : null);
    setMentionIndex(0);

    const now = Date.now();
    if (value.trim() && now - lastTypingRef.current > 3000) {
      lastTypingRef.current = now;
      socket.send({ t: 'typing', channelId, threadRootId });
    }
  }

  function applyMention(name: string) {
    const node = textareaRef.current;
    const caret = node?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret).replace(/@([\p{L}\p{N}._'-]*)$/u, `@${name} `);
    const next = before + draft.slice(caret);
    setDraft(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      node?.focus();
      node?.setSelectionRange(before.length, before.length);
    });
  }

  async function submit() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft('');
    try {
      await sendMessage(channelId, body, threadRootId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "That message couldn't be sent.";
      setError(`${message} It's kept in the outbox below so you can retry or discard it.`);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && candidates.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionIndex((i) => (i + 1) % candidates.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionIndex((i) => (i - 1 + candidates.length) % candidates.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const chosen = candidates[mentionIndex];
        if (chosen) applyMention(chosen.displayName);
        return;
      }
      if (event.key === 'Escape') {
        setMentionQuery(null);
        return;
      }
    }

    const sendCombo = enterToSend ? !event.shiftKey : event.metaKey || event.ctrlKey;
    if (event.key === 'Enter' && sendCombo) {
      event.preventDefault();
      void submit();
    }
  }

  const ready = draft.trim().length > 0;

  return (
    <div className="composer">
      <div className="composer-wrap">
        {mentionQuery !== null && candidates.length > 0 && (
          <div className="autocomplete" role="listbox">
            {candidates.map((candidate, index) => (
              <button
                key={candidate.id}
                className="autocomplete-item"
                data-active={index === mentionIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyMention(candidate.displayName);
                }}
              >
                {candidate.id.startsWith('@') ? (
                  <MentionIcon size={16} />
                ) : (
                  <Avatar user={candidate} size="sm" />
                )}
                {candidate.displayName}
              </button>
            ))}
          </div>
        )}

        {emojiOpen && (
          <div className="autocomplete" style={{ width: 'max-content', display: 'flex', gap: 4 }}>
            {EMOJI_PICKS.map((emoji) => (
              <button
                key={emoji}
                className="message-action"
                data-emoji="true"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setDraft((d) => d + emoji);
                  setEmojiOpen(false);
                  textareaRef.current?.focus();
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        <div className="composer-box">
          <textarea
            ref={textareaRef}
            className="composer-input"
            value={draft}
            placeholder={placeholder}
            rows={2}
            autoFocus={autoFocus}
            onChange={(e) => updateDraft(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label={placeholder}
          />

          <div className="composer-footer">
            <button className="icon-btn" title="Attach a file" disabled>
              <AttachIcon />
            </button>
            <button
              className="icon-btn"
              title="Emoji"
              onClick={() => setEmojiOpen((open) => !open)}
              aria-expanded={emojiOpen}
            >
              <EmojiIcon />
            </button>
            <button
              className="icon-btn"
              title="Mention someone"
              onMouseDown={(e) => {
                e.preventDefault();
                updateDraft(`${draft}@`);
                textareaRef.current?.focus();
              }}
            >
              <MentionIcon />
            </button>
            <span style={{ flex: 1 }} />
            <span className="composer-hint">
              {enterToSend ? 'Enter to send' : '⌘Enter to send'}
            </span>
            <button
              className="send-btn"
              data-ready={ready}
              onClick={() => void submit()}
              disabled={!ready || sending}
              title="Send"
            >
              <SendIcon size={15} />
            </button>
          </div>
        </div>

        {error && (
          <p className="error-text" style={{ marginTop: 8 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
