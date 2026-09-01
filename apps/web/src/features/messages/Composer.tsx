/**
 * The composer.
 *
 * Enter sends, Shift+Enter breaks the line (invertible in preferences). `@` opens
 * mention autocomplete against the same name index the server uses to resolve
 * mentions, so what highlights here is exactly what notifies there.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import type { User } from "@blob/shared";
import { matchMentions } from "./mentionMatch.ts";
import { useStore } from "../../lib/store.ts";
import { draftKey } from "../../lib/drafts.ts";
import { socket } from "../../lib/socket.ts";
import { api } from "../../lib/api.ts";
import { showError, useToasts } from "../../lib/toasts.ts";
import {
  commandQuery,
  localCommand,
  matchAllCommands,
  parseCommand,
  type LocalCommandContext,
} from "../../lib/commands.ts";
import {
  SHORTCUTS,
  describeKeys,
  isMac,
  matchShortcut,
} from "../../lib/shortcuts.ts";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  describeSize,
  newPendingAttachment,
  uploadFile,
  type PendingAttachment,
} from "../../lib/attachments.ts";
import { openAgentTerminal } from "../../lib/agentTerminal.ts";
import { Menu } from "../../components/Menu.tsx";
import { earliestCustom, presetsFor } from "./schedulePresets.ts";
import { Avatar } from "../../components/Avatar.tsx";
import { EmojiPicker } from "../../components/EmojiPicker.tsx";
import {
  AttachIcon,
  CloseIcon,
  EmojiIcon,
  FileIcon,
  MentionIcon,
  SendIcon,
  ClockIcon,
} from "../../components/Icon.tsx";

/**
 * One row of the `@` autocomplete.
 *
 * A discriminated union rather than a loose object with an id that might start with "@".
 * The old shape worked because a person and a special both happened to have a
 * `displayName` and an `avatarUrl`; a group has neither, and would have reached `Avatar`
 * as a silently wrong shape.
 */
type MentionCandidate =
  | { kind: "special"; key: string; label: string; hint?: string; user?: never }
  | { kind: "group"; key: string; label: string; hint?: string; user?: never }
  | { kind: "user"; key: string; label: string; hint?: string; user: User };

/**
 * A toolbar tooltip's chord, read from the same declarations `⌘/` renders — so the
 * toolbar cannot advertise a binding the keyboard layer doesn't have.
 */
function chordFor(id: string): string {
  const shortcut = SHORTCUTS.find((s) => s.id === id);
  return shortcut ? describeKeys(shortcut).join(isMac() ? "" : "+") : "";
}

interface Props {
  channelId: string;
  threadRootId?: string | null;
  placeholder: string;
  initialFocus?: boolean;
  /** Asked at the moment of sending — "should this reply also post to the channel?"
   * A function rather than a boolean so the owner can reset its checkbox in the same
   * breath, which is Slack's contract: the tick applies to one message. */
  consumeAlsoInChannel?: () => boolean;
}

export function Composer({
  channelId,
  threadRootId = null,
  placeholder,
  initialFocus,
  consumeAlsoInChannel,
}: Props) {
  const users = useStore((s) => s.users);
  const channels = useStore((s) => s.channels);
  const groupsById = useStore((s) => s.groups);
  const currentUser = useStore((s) => s.currentUser);
  const sendMessage = useStore((s) => s.sendMessage);
  const applyEvent = useStore((s) => s.applyEvent);
  const editLastMessage = useStore((s) => s.editLastMessage);
  const enterToSend = useStore((s) => s.currentUser?.prefs.enterToSend ?? true);

  // Backed by the store rather than by local state, so what you typed survives leaving
  // the channel — the one piece of state here with no server behind it that still has to
  // last. Reading by key means switching channels is reading a different entry; there is
  // no save-on-unmount, and nothing to lose if a component is torn down without warning.
  const key = draftKey(channelId, threadRootId);
  const draft = useStore((s) => s.drafts[key]?.body ?? "");
  const writeDraft = useStore((s) => s.setDraft);
  const setDraft = useCallback(
    (value: string) => writeDraft(channelId, threadRootId, value),
    [writeDraft, channelId, threadRootId],
  );
  const [sending, setSending] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [customWhen, setCustomWhen] = useState("");
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

  const candidates = useMemo<MentionCandidate[]>(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();

    const specials: MentionCandidate[] = ["channel", "here"]
      .filter((s) => s.startsWith(q))
      .map((name) => ({ kind: "special", key: `@${name}`, label: name }));

    // Not self-filtered, unlike people below. Excluding yourself from a list of people
    // is right — you do not mention yourself — and exactly wrong for a group you are
    // on, which is the one you are most likely to be addressing. Matched on its name as
    // well as its handle, because "@plat" should find `@platform-team` whether you were
    // reaching for the handle or the words behind it.
    const groups: MentionCandidate[] = matchMentions(
      Object.values(groupsById),
      q,
      (g) => [g.handle, g.name],
      (g) => g.handle,
      4,
    ).map((g) => ({ kind: "group", key: g.id, label: g.handle, hint: g.name }));

    const people: MentionCandidate[] = matchMentions(
      Object.values(users).filter(
        (u) => !u.deactivated && u.id !== currentUser?.id,
      ),
      q,
      (u) => [u.displayName, u.fullName],
      (u) => u.displayName,
      6,
    ).map((u) => ({ kind: "user", key: u.id, label: u.displayName, user: u }));

    return [...specials, ...groups, ...people];
  }, [mentionQuery, users, groupsById, currentUser]);

  /**
   * Commands to offer while the name is half-typed.
   *
   * Only in the channel composer: a command acts on the channel, so running one from a
   * thread would put its answer somewhere the person could not see it. In a thread a
   * leading slash is ordinary text, which is also the only way to send one as text.
   */
  /**
   * Who this conversation is with, for the commands the client answers itself.
   *
   * Only a one-to-one DM: a group DM has no single agent to open a terminal in, and a
   * channel an agent is a member of is not a conversation *with* it.
   */
  const localContext = useMemo<LocalCommandContext>(() => {
    const channel = channels[channelId];
    const otherId =
      channel?.kind === "dm"
        ? (channel.memberIds ?? []).find((id) => id !== currentUser?.id)
        : undefined;
    const other = otherId ? users[otherId] : undefined;
    return {
      botUserId: other?.kind === "bot" ? other.id : null,
      isAdmin: currentUser?.role === "admin" || currentUser?.role === "owner",
    };
  }, [channels, channelId, users, currentUser]);

  const commandMatches = useMemo(() => {
    if (threadRootId) return [];
    const query = commandQuery(draft);
    return query === null
      ? []
      : matchAllCommands(query, commands, localContext);
  }, [draft, commands, threadRootId, localContext]);

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

  async function scheduleFor(when: Date) {
    setScheduleOpen(false);
    const body = draft;
    setSending(true);
    try {
      await api.channels.schedule(channelId, {
        body,
        sendAt: when.toISOString(),
        clientMsgId: crypto.randomUUID(),
        threadRootId: threadRootId ?? null,
      });
      // Cleared only once the server has it: a draft dropped on a failed request is a
      // message somebody has to write twice.
      setDraft("");
      setCustomWhen("");
      useToasts.getState().push(
        "info",
        `Scheduled for ${when.toLocaleString(undefined, {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        })}`,
      );
    } catch (err) {
      showError(err);
    } finally {
      setSending(false);
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

    // Answered here, so it never reaches `/api/commands`: what it does is open a panel
    // on this screen, and the server has nothing to add to that.
    const botUserId = localContext.botUserId;
    if (parsed && botUserId && localCommand(parsed.name, localContext)) {
      setDraft("");
      setEphemeral(null);
      setError(null);
      void openAgentTerminal(botUserId);
      return;
    }

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
        if (result.message)
          applyEvent({ t: "message.new", message: result.message });
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
        consumeAlsoInChannel?.() ?? false,
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

  /**
   * Wrap the selection in a Markdown marker, or strip the marker if it is already
   * there — whether the markers sit inside the selection (`**bold**` selected) or
   * just around it (`bold` selected inside `**bold**`). The selection is restored
   * on the next frame, once React has written the new value — setting it
   * synchronously targets the old one.
   */
  function toggleWrap(before: string, after = before) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = draft.slice(start, end);

    let next: string;
    let selStart: number;
    let selEnd: number;

    if (
      selected.length >= before.length + after.length &&
      selected.startsWith(before) &&
      selected.endsWith(after)
    ) {
      const inner = selected.slice(
        before.length,
        selected.length - after.length,
      );
      next = draft.slice(0, start) + inner + draft.slice(end);
      selStart = start;
      selEnd = start + inner.length;
    } else if (
      start >= before.length &&
      draft.slice(start - before.length, start) === before &&
      draft.slice(end, end + after.length) === after
    ) {
      next =
        draft.slice(0, start - before.length) +
        selected +
        draft.slice(end + after.length);
      selStart = start - before.length;
      selEnd = selStart + selected.length;
    } else {
      next =
        draft.slice(0, start) + before + selected + after + draft.slice(end);
      selStart = start + before.length;
      selEnd = selStart + selected.length;
    }

    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  }

  // Inline code cannot hold a newline — the renderer's rule is `[^`\n]+` — so a
  // selection spanning lines becomes a fenced block instead.
  function toggleCode() {
    const el = textareaRef.current;
    if (!el) return;
    const selected = draft.slice(el.selectionStart, el.selectionEnd);
    if (selected.includes("\n")) toggleWrap("```\n", "\n```");
    else toggleWrap("`");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Bound through the same declarations `⌘/` renders. Anything matched that is not
    // a formatting chord falls through to the window listener in Workspace.
    const shortcut = matchShortcut(event, { typing: true });
    switch (shortcut?.id) {
      case "format-bold":
        event.preventDefault();
        toggleWrap("**");
        return;
      case "format-italic":
        // The renderer parses *x* and _x_ alike; `_` is what survives sitting
        // directly inside a ** wrap.
        event.preventDefault();
        toggleWrap("_");
        return;
      case "format-code":
        event.preventDefault();
        toggleCode();
        return;
      case "format-strike":
        event.preventDefault();
        toggleWrap("~~");
        return;
    }

    if (commandMatches.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setCommandIndex((i) => (i + 1) % commandMatches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setCommandIndex(
          (i) => (i - 1 + commandMatches.length) % commandMatches.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
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
        if (chosen) applyMention(chosen.label);
        return;
      }
      if (event.key === "Escape") {
        setMentionQuery(null);
        return;
      }
    }

    // ↑ on an empty composer edits your last message, as it does in Slack. Only when
    // empty and only with the caret at the start — otherwise it would hijack moving
    // through text somebody is in the middle of writing, which is the one way this
    // shortcut turns from a convenience into a defect.
    if (
      event.key === "ArrowUp" &&
      !draft &&
      attachments.length === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey
    ) {
      if (editLastMessage(channelId, threadRootId)) event.preventDefault();
      return;
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
        {/* The listbox had buttons for children, which is a listbox with no options in
            it — worse than no role at all, because it announced an empty list rather
            than nothing. The active row was `data-active` and CSS only, so arrowing
            through names was silent; `aria-activedescendant` on the textarea below is
            what makes it audible while focus stays in the message field. */}
        {mentionQuery !== null && candidates.length > 0 && (
          <div className="autocomplete" role="listbox" id="mention-options">
            {candidates.map((candidate, index) => (
              <button
                key={candidate.key}
                id={`mention-option-${index}`}
                role="option"
                aria-selected={index === mentionIndex}
                className="autocomplete-item"
                data-active={index === mentionIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyMention(candidate.label);
                }}
              >
                {candidate.kind === "user" ? (
                  <Avatar user={candidate.user} size="sm" />
                ) : (
                  <MentionIcon size="md" />
                )}
                {candidate.label}
                {candidate.hint && (
                  <span className="muted autocomplete-hint">
                    {candidate.hint}
                  </span>
                )}
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
          <div
            className="emoji-picker-anchor"
            data-composer="true"
            ref={emojiRef}
          >
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
          <div
            className="composer-toolbar"
            role="toolbar"
            aria-label="Formatting"
          >
            <button
              className="icon-btn"
              type="button"
              aria-label="Bold"
              title={`Bold (${chordFor("format-bold")})`}
              onMouseDown={(e) => {
                // Only to keep the textarea's selection: without this the mousedown
                // moves focus to the button and the selection collapses before the
                // action can read it. The action itself is on click, so Enter and
                // Space reach it too.
                e.preventDefault();
              }}
              onClick={() => toggleWrap("**")}
            >
              <strong>B</strong>
            </button>
            <button
              className="icon-btn"
              type="button"
              aria-label="Italic"
              title={`Italic (${chordFor("format-italic")})`}
              onMouseDown={(e) => {
                // Only to keep the textarea's selection: without this the mousedown
                // moves focus to the button and the selection collapses before the
                // action can read it. The action itself is on click, so Enter and
                // Space reach it too.
                e.preventDefault();
              }}
              onClick={() => toggleWrap("_")}
            >
              <em>I</em>
            </button>
            <button
              className="icon-btn"
              type="button"
              aria-label="Code"
              title={`Code (${chordFor("format-code")})`}
              onMouseDown={(e) => {
                // Only to keep the textarea's selection: without this the mousedown
                // moves focus to the button and the selection collapses before the
                // action can read it. The action itself is on click, so Enter and
                // Space reach it too.
                e.preventDefault();
              }}
              onClick={() => toggleCode()}
            >
              <code>{"</>"}</code>
            </button>
            <button
              className="icon-btn"
              type="button"
              aria-label="Strikethrough"
              title={`Strikethrough (${chordFor("format-strike")})`}
              onMouseDown={(e) => {
                // Only to keep the textarea's selection: without this the mousedown
                // moves focus to the button and the selection collapses before the
                // action can read it. The action itself is on click, so Enter and
                // Space reach it too.
                e.preventDefault();
              }}
              onClick={() => toggleWrap("~~")}
            >
              <s>S</s>
            </button>
          </div>

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
                      <FileIcon size="md" />
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
                    <CloseIcon size="sm" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <textarea
            ref={textareaRef}
            className="composer-input"
            name="message"
            value={draft}
            placeholder={placeholder}
            rows={2}
            onChange={(e) => updateDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            aria-label={placeholder}
            // Only while the list is open. This stays a message field — it is not
            // relabelled a combobox, because that is what it is for ninety-nine
            // keystrokes in a hundred and a textarea announced as a combobox all the
            // time is a worse trade than a silent list some of the time.
            aria-controls={
              mentionQuery !== null && candidates.length > 0
                ? "mention-options"
                : undefined
            }
            aria-activedescendant={
              mentionQuery !== null && candidates.length > 0
                ? `mention-option-${mentionIndex}`
                : undefined
            }
          />

          <div className="composer-footer">
            <input
              ref={fileInputRef}
              type="file"
              name="attachment"
              aria-label="Attach a file"
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
              aria-label="Attach a file"
              data-tooltip="Attach a file"
              data-tooltip-place="top"
              onClick={() => fileInputRef.current?.click()}
            >
              <AttachIcon />
            </button>
            <button
              ref={emojiTriggerRef}
              className="icon-btn"
              type="button"
              aria-label="Emoji"
              data-tooltip="Emoji"
              data-tooltip-place="top"
              onClick={() => setEmojiOpen((open) => !open)}
              aria-expanded={emojiOpen}
              aria-haspopup="dialog"
            >
              <EmojiIcon />
            </button>
            <button
              className="icon-btn"
              type="button"
              aria-label="Mention someone"
              data-tooltip="Mention someone"
              data-tooltip-place="top"
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
              aria-label="Send"
              data-tooltip="Send"
              data-tooltip-place="top"
            >
              <SendIcon size="md" />
            </button>
            {/* Beside Send rather than in the ⋯ menu: the decision "now or later" is
                made at the moment of sending, with the message already written. */}
            <div className="schedule-wrap">
              <button
                className="icon-btn schedule-trigger"
                type="button"
                aria-label="Schedule this message"
                aria-haspopup="menu"
                aria-expanded={scheduleOpen}
                data-tooltip="Send later"
                data-tooltip-place="top"
                disabled={!ready || sending}
                onClick={(event) => {
                  event.stopPropagation();
                  setScheduleOpen((open) => !open);
                }}
              >
                <ClockIcon size="md" />
              </button>
              <Menu
                open={scheduleOpen}
                onClose={() => setScheduleOpen(false)}
                className="menu schedule-menu"
              >
                {presetsFor(new Date()).map((preset) => (
                  <button
                    key={preset.id}
                    className="menu-item"
                    role="menuitem"
                    type="button"
                    onClick={() => void scheduleFor(preset.at(new Date()))}
                  >
                    {preset.label}
                  </button>
                ))}
                <div className="menu-sep" />
                {/* Four moments cannot express "next Thursday at two". The native
                    control is the right one here: it already knows the reader's locale,
                    their 12- or 24-hour clock, and how a date is spelled where they
                    are — none of which a hand-rolled picker would get right for free. */}
                <label className="schedule-custom">
                  <span className="field-label">Or pick a time</span>
                  <input
                    className="input"
                    type="datetime-local"
                    name="schedule-custom"
                    min={earliestCustom(new Date())}
                    value={customWhen}
                    onChange={(event) => setCustomWhen(event.target.value)}
                  />
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={!customWhen}
                    onClick={() => {
                      // A datetime-local string has no zone, so it parses as local —
                      // which is what the person typing it meant.
                      const when = new Date(customWhen);
                      if (Number.isNaN(when.getTime())) return;
                      void scheduleFor(when);
                    }}
                  >
                    Schedule
                  </button>
                </label>
              </Menu>
            </div>
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
