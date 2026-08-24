/**
 * The composer.
 *
 * Enter sends, Shift+Enter breaks the line (invertible in preferences). `@` opens
 * mention autocomplete against the same name index the server uses to resolve
 * mentions, so what highlights here is exactly what notifies there.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { useStore } from "../../lib/store.ts";
import { socket } from "../../lib/socket.ts";
import { api } from "../../lib/api.ts";
import { commandQuery, matchCommands, parseCommand } from "../../lib/commands.ts";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  describeSize,
  newPendingAttachment,
  uploadFile,
  type PendingAttachment,
} from "../../lib/attachments.ts";
import { Avatar } from "../../components/Avatar.tsx";
import { EmojiPicker } from "../../components/EmojiPicker.tsx";
import {
  AttachIcon,
  CloseIcon,
  EmojiIcon,
  FileIcon,
  MentionIcon,
  SendIcon,
} from "../../components/Icon.tsx";


interface Props {
  channelId: string;
  threadRootId?: string | null;
  placeholder: string;
  initialFocus?: boolean;
}

export function Composer({
  channelId,
  threadRootId = null,
  placeholder,
  initialFocus,
}: Props) {
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const sendMessage = useStore((s) => s.sendMessage);
  const applyEvent = useStore((s) => s.applyEvent);
  const enterToSend = useStore((s) => s.currentUser?.prefs.enterToSend ?? true);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiRef = useRef<HTMLDivElement>(null);
  const commands = useStore((s) => s.commands);
  const [commandIndex, setCommandIndex] = useState(0);
  /** A command's reply to the person who ran it. Never stored, never broadcast. */
  const [ephemeral, setEphemeral] = useState<string | null>(null);
  const emojiTriggerRef = useRef<HTMLButtonElement>(null);

  // Dismiss on a click anywhere else, or Escape — the same contract as every other panel
  // in the app. The trigger is checked too, and deliberately: the panel renders above the
  // composer box while the button lives in the footer, so unlike the account menu it
  // cannot simply sit inside the same ref. Without this the capture listener would close
  // on the way down and the button's own toggle would reopen on the way back up, leaving
  // a picker that could never be dismissed by clicking the thing that opened it.
  useEffect(() => {
    if (!emojiOpen) return undefined;
    // Qualified, because this file imports React's KeyboardEvent for the textarea
    // handlers and the bare names would resolve to those rather than to the DOM's.
    const onClick = (event: globalThis.MouseEvent) => {
      const target = event.target as Node;
      if (emojiRef.current?.contains(target)) return;
      if (emojiTriggerRef.current?.contains(target)) return;
      setEmojiOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setEmojiOpen(false);
    };
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [emojiOpen]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingRef = useRef(0);

  // Grow with content rather than scrolling a fixed two-line box.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [draft]);

  useEffect(() => {
    if (!initialFocus) return;
    textareaRef.current?.focus();
  }, [initialFocus]);

  const candidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    const people = Object.values(users)
      .filter((u) => !u.deactivated && u.id !== currentUser?.id)
      .filter((u) => u.displayName.toLowerCase().includes(q))
      .slice(0, 6);
    const specials = ["channel", "here"].filter((s) => s.startsWith(q));
    return [
      ...specials.map((name) => ({
        id: `@${name}`,
        displayName: name,
        avatarUrl: null,
      })),
      ...people,
    ];
  }, [mentionQuery, users, currentUser]);

  /**
   * Commands to offer while the name is half-typed.
   *
   * Only in the channel composer: a command acts on the channel, so running one from a
   * thread would put its answer somewhere the person could not see it. In a thread a
   * leading slash is ordinary text, which is also the only way to send one as text.
   */
  const commandMatches = useMemo(() => {
    if (threadRootId) return [];
    const query = commandQuery(draft);
    return query === null ? [] : matchCommands(query, commands);
  }, [draft, commands, threadRootId]);

  /**
   * Put an emoji where the caret is, not at the end.
   *
   * Appending is fine for the `@` button, which is always starting a new mention; an
   * emoji is just as often going into the middle of a sentence already typed. The caret
   * is restored past the inserted text on the next frame, once React has written the
   * new value — setting it synchronously targets the old one.
   */
  function insertAtCursor(value: string) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? start;
    const inserted = `${value} `;
    updateDraft(`${draft.slice(0, start)}${inserted}${draft.slice(end)}`);
    requestAnimationFrame(() => {
      const caret = start + inserted.length;
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  function updateDraft(value: string) {
    setDraft(value);
    setError(null);

    // Track a trailing `@word` to drive the autocomplete.
    const match = value
      .slice(0, textareaRef.current?.selectionStart ?? value.length)
      .match(/@([\p{L}\p{N}._'-]*)$/u);
    setMentionQuery(match ? (match[1] ?? "") : null);
    setMentionIndex(0);
    setCommandIndex(0);

    const now = Date.now();
    if (value.trim() && now - lastTypingRef.current > 3000) {
      lastTypingRef.current = now;
      socket.send({ t: "typing", channelId, threadRootId });
    }
  }

  function applyMention(name: string) {
    const node = textareaRef.current;
    const caret = node?.selectionStart ?? draft.length;
    const before = draft
      .slice(0, caret)
      .replace(/@([\p{L}\p{N}._'-]*)$/u, `@${name} `);
    const next = before + draft.slice(caret);
    setDraft(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      node?.focus();
      node?.setSelectionRange(before.length, before.length);
    });
  }

  // Object URLs for image previews are revoked when the composer goes away; not doing so
  // leaks the whole file for the life of the tab.
  useEffect(() => {
    return () => {
      for (const attachment of attachments) {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      }
    };
    // Deliberately on unmount only: revoking on every change would kill live previews.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(key: string, patch: Partial<PendingAttachment>) {
    setAttachments((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  }

  function discard(key: string) {
    setAttachments((current) => {
      const going = current.find((item) => item.key === key);
      if (going?.previewUrl) URL.revokeObjectURL(going.previewUrl);
      return current.filter((item) => item.key !== key);
    });
  }

  function attach(files: File[]) {
    if (files.length === 0) return;
    setError(null);

    const room = MAX_ATTACHMENTS_PER_MESSAGE - attachments.length;
    if (room <= 0) {
      setError(
        `A message can carry ${MAX_ATTACHMENTS_PER_MESSAGE} files at most.`,
      );
      return;
    }
    if (files.length > room) {
      setError(`Only the first ${room} of those fit on this message.`);
    }

    for (const file of files.slice(0, room)) {
      const pending = newPendingAttachment(file);
      setAttachments((current) => [...current, pending]);

      void uploadFile(file, pending.mime)
        .then((attachmentId) =>
          update(pending.key, { attachmentId, status: "ready" }),
        )
        .catch((err: unknown) => {
          const message =
            err instanceof Error
              ? err.message
              : "That file could not be uploaded.";
          update(pending.key, { status: "failed", error: message });
        });
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    // A pasted screenshot arrives as a file with no name the user chose. Text pastes
    // carry no files, so this never interferes with ordinary copy and paste.
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    attach(files);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    attach(Array.from(event.dataTransfer.files));
  }

  async function submit() {
    const body = draft.trim();
    const ready = attachments.filter(
      (item) => item.status === "ready" && item.attachmentId,
    );
    if ((!body && ready.length === 0) || sending) return;
    if (attachments.some((item) => item.status === "uploading")) {
      setError("One of those files is still uploading.");
      return;
    }

    // A command is typed like a message and is not one: it goes to its own endpoint,
    // and what comes back is either a real message the socket will also deliver, or a
    // note only this person sees. Threads are excluded — see `commandMatches`.
    const parsed = threadRootId ? null : parseCommand(body);
    if (parsed) {
      setSending(true);
      setDraft("");
      setEphemeral(null);
      try {
        const result = await api.messages.command({
          channelId,
          text: body,
          clientMsgId: crypto.randomUUID(),
        });
        setEphemeral(result.ephemeral);
        // The socket delivers this too; applying it here is what makes the message
        // appear at once for the person who ran the command, exactly as a send does.
        if (result.message) applyEvent({ t: "message.new", message: result.message });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "That command couldn't be run.";
        setError(message);
        setDraft(body);
      } finally {
        setSending(false);
      }
      return;
    }

    setSending(true);
    setDraft("");
    setAttachments([]);
    for (const item of attachments) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }

    try {
      await sendMessage(
        channelId,
        body,
        threadRootId,
        ready.map((item) => item.attachmentId as string),
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "That message couldn't be sent.";
      setError(
        `${message} It's kept in the outbox below so you can retry or discard it.`,
      );
    } finally {
      setSending(false);
    }
  }

  function applyCommand(name: string) {
    // A trailing space, so the next keystroke is the argument rather than more name.
    const next = `/${name} `;
    setDraft(next);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next.length, next.length);
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (commandMatches.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setCommandIndex((i) => (i + 1) % commandMatches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setCommandIndex((i) => (i - 1 + commandMatches.length) % commandMatches.length);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const chosen = commandMatches[commandIndex];
        if (chosen) applyCommand(chosen.name);
        return;
      }
    }

    if (mentionQuery !== null && candidates.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((i) => (i + 1) % candidates.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((i) => (i - 1 + candidates.length) % candidates.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const chosen = candidates[mentionIndex];
        if (chosen) applyMention(chosen.displayName);
        return;
      }
      if (event.key === "Escape") {
        setMentionQuery(null);
        return;
      }
    }

    const sendCombo = enterToSend
      ? !event.shiftKey
      : event.metaKey || event.ctrlKey;
    if (event.key === "Enter" && sendCombo) {
      event.preventDefault();
      void submit();
    }
  }

  // A message can be nothing but files, which is what the server accepts too.
  const ready =
    draft.trim().length > 0 ||
    attachments.some((item) => item.status === "ready");

  return (
    <div className="composer">
      <div
        className="composer-wrap"
        data-dragging={dragging}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          // Moving between children fires dragleave; only the real exit counts.
          if (event.currentTarget.contains(event.relatedTarget as Node | null))
            return;
          setDragging(false);
        }}
        onDrop={onDrop}
      >
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
                {candidate.id.startsWith("@") ? (
                  <MentionIcon size={16} />
                ) : (
                  <Avatar user={candidate} size="sm" />
                )}
                {candidate.displayName}
              </button>
            ))}
          </div>
        )}

        {ephemeral !== null && (
          <div className="ephemeral-note" role="status">
            <div className="ephemeral-body">{ephemeral}</div>
            <div className="ephemeral-meta">
              <span>Only visible to you</span>
              <button
                className="ephemeral-dismiss"
                type="button"
                onClick={() => setEphemeral(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {commandMatches.length > 0 && (
          <div className="autocomplete" role="listbox">
            {commandMatches.map((command, index) => (
              <button
                key={command.name}
                className="autocomplete-item"
                data-active={index === commandIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyCommand(command.name);
                }}
              >
                <span className="command-name">
                  /{command.name}
                  {command.usage ? ` ${command.usage}` : ""}
                </span>
                <span className="command-summary">{command.summary}</span>
              </button>
            ))}
          </div>
        )}

        {emojiOpen && (
          <div className="emoji-picker-anchor" data-composer="true" ref={emojiRef}>
            <EmojiPicker
              label="Insert an emoji"
              onClose={() => setEmojiOpen(false)}
              onPick={(value) => {
                insertAtCursor(value);
                setEmojiOpen(false);
              }}
            />
          </div>
        )}

        <div className="composer-box">
          {attachments.length > 0 && (
            <ul className="attachment-tray">
              {attachments.map((item) => (
                <li
                  key={item.key}
                  className="attachment-chip"
                  data-status={item.status}
                >
                  {item.previewUrl ? (
                    <img
                      className="attachment-chip-thumb"
                      src={item.previewUrl}
                      alt=""
                    />
                  ) : (
                    <span className="attachment-chip-thumb" data-generic="true">
                      <FileIcon size={16} />
                    </span>
                  )}
                  <span className="attachment-chip-text">
                    <span
                      className="attachment-chip-name"
                      title={item.filename}
                    >
                      {item.filename}
                    </span>
                    <span className="attachment-chip-meta">
                      {item.status === "uploading" && "Uploading…"}
                      {item.status === "ready" && describeSize(item.sizeBytes)}
                      {item.status === "failed" &&
                        (item.error ?? "Upload failed")}
                    </span>
                  </span>
                  <button
                    className="attachment-chip-remove"
                    onClick={() => discard(item.key)}
                    title={`Remove ${item.filename}`}
                  >
                    <CloseIcon size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <textarea
            ref={textareaRef}
            className="composer-input"
            value={draft}
            placeholder={placeholder}
            rows={2}
            onChange={(e) => updateDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            aria-label={placeholder}
          />

          <div className="composer-footer">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                attach(Array.from(event.target.files ?? []));
                // Reset, or choosing the same file twice in a row does nothing.
                event.target.value = "";
              }}
            />
            <button
              className="icon-btn"
              type="button"
              title="Attach a file"
              onClick={() => fileInputRef.current?.click()}
            >
              <AttachIcon />
            </button>
            <button
              ref={emojiTriggerRef}
              className="icon-btn"
              type="button"
              title="Emoji"
              onClick={() => setEmojiOpen((open) => !open)}
              aria-expanded={emojiOpen}
              aria-haspopup="dialog"
            >
              <EmojiIcon />
            </button>
            <button
              className="icon-btn"
              type="button"
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
              {enterToSend ? "Enter to send" : "⌘Enter to send"}
            </span>
            <button
              className="send-btn"
              type="button"
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
