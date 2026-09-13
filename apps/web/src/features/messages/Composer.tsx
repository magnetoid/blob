/**
 * The composer.
 *
 * Enter sends, Shift+Enter breaks the line (invertible in preferences). The three lists
 * that can open under the field — `@` people, `:` emoji, `/` commands — are each a hook
 * beside this file, and they answer the keyboard in that order before the composer's own
 * bindings see the event. What stays here is the message: the draft, the send, and the
 * one command the client answers itself.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { ScheduleRepeat } from "@blob/shared";
import { useStore } from "../../lib/store.ts";
import { draftKey } from "../../lib/drafts.ts";
import { socket } from "../../lib/socket.ts";
import { api } from "../../lib/api.ts";
import { showError, useToasts } from "../../lib/toasts.ts";
import { localCommand, parseCommand } from "../../lib/commands.ts";
import { matchShortcut } from "../../lib/shortcuts.ts";
import { openAgentTerminal } from "../../lib/agentTerminal.ts";
import { showChannel } from "../../lib/navigation.ts";
import { useEscape } from "../../lib/useEscape.ts";
import { localZone, describeRepeat } from "./schedulePresets.ts";
import { codeMarkers, wrapSelection } from "./markdownWrap.ts";
import { EmojiPicker } from "../../components/EmojiPicker.tsx";
import {
  AttachIcon,
  EmojiIcon,
  MentionIcon,
  SendIcon,
} from "../../components/Icon.tsx";
import { AttachmentTray } from "./AttachmentTray.tsx";
import { FormatToolbar } from "./FormatToolbar.tsx";
import { SchedulePicker } from "./SchedulePicker.tsx";
import {
  CommandOptions,
  EmojiOptions,
  MentionOptions,
} from "./ComposerOptions.tsx";
import { useAttachments } from "./useAttachments.ts";
import { useEmojiAutocomplete } from "./useEmojiAutocomplete.ts";
import { useMentionAutocomplete } from "./useMentionAutocomplete.ts";
import { useSlashCommands } from "./useSlashCommands.ts";

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
  const [error, setError] = useState<string | null>(null);
  /** A command's reply to the person who ran it. Never stored, never broadcast. */
  const [ephemeral, setEphemeral] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiRef = useRef<HTMLDivElement>(null);
  const emojiTriggerRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingRef = useRef(0);

  const mentions = useMentionAutocomplete(draft, setDraft, textareaRef);
  const emoji = useEmojiAutocomplete(draft, setDraft, textareaRef);
  const slash = useSlashCommands(
    channelId,
    threadRootId,
    draft,
    setDraft,
    textareaRef,
  );
  const files = useAttachments(setError);
  const { attachments } = files;

  // Escape through the shared stack, so closing the picker does not also let the shell
  // act on the key. See `lib/useEscape`.
  const closeEmoji = useCallback(() => setEmojiOpen(false), []);
  useEscape(closeEmoji, emojiOpen);

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
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [emojiOpen]);

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

    const caret = textareaRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    // A `@word` and a `:shortcode` cannot both be open: the mention wins where they
    // would overlap, which is what the single regex pair did when this was one function.
    const mentioning = mentions.track(before);
    if (mentioning) emoji.track("");
    else emoji.track(before);
    slash.reset();

    const now = Date.now();
    if (value.trim() && now - lastTypingRef.current > 3000) {
      lastTypingRef.current = now;
      socket.send({ t: "typing", channelId, threadRootId });
    }
  }

  async function scheduleFor(
    when: Date,
    repeat: ScheduleRepeat | null,
  ): Promise<boolean> {
    const body = draft.trim();
    setSending(true);
    try {
      await api.channels.schedule(channelId, {
        body,
        sendAt: when.toISOString(),
        clientMsgId: crypto.randomUUID(),
        threadRootId: threadRootId ?? null,
        repeat,
        // Sent whether or not it repeats: it costs nothing, and it is what lets a rule
        // added later keep the wall clock the author picked.
        timezone: localZone(),
      });
      // Cleared only once the server has it: a draft dropped on a failed request is a
      // message somebody has to write twice.
      setDraft("");
      const repeats = describeRepeat(repeat);
      useToasts.getState().push(
        "info",
        `Scheduled for ${when.toLocaleString(undefined, {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        })}${repeats ? `, ${repeats.toLowerCase()}` : ""}`,
      );
      return true;
    } catch (err) {
      showError(err);
      return false;
    } finally {
      setSending(false);
    }
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
    // note only this person sees. Threads are excluded — see `useSlashCommands`.
    const parsed = threadRootId ? null : parseCommand(body);

    // Answered here, so it never reaches `/api/commands`: what it does is open a panel
    // on this screen, and the server has nothing to add to that.
    const botUserId = slash.localContext.botUserId;
    if (parsed && botUserId && localCommand(parsed.name, slash.localContext)) {
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
        // `/join #design` takes you to #design. Leaving somebody looking at where they
        // were, with a new row in the sidebar, is a command they have to follow up by
        // hand — which is not what the word means.
        if (result.channel) {
          applyEvent({ t: "channel.created", channel: result.channel });
          void showChannel(result.channel.id);
        }
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
    files.clear();

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

  /** The selection restored on the next frame, once React has written the new value —
   *  setting it synchronously targets the old one. */
  function applyWrap(before: string, after = before) {
    const el = textareaRef.current;
    if (!el) return;
    const wrapped = wrapSelection(
      draft,
      el.selectionStart,
      el.selectionEnd,
      before,
      after,
    );
    setDraft(wrapped.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(wrapped.selectionStart, wrapped.selectionEnd);
    });
  }

  function toggleCode() {
    const el = textareaRef.current;
    if (!el) return;
    applyWrap(...codeMarkers(draft.slice(el.selectionStart, el.selectionEnd)));
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Bound through the same declarations `⌘/` renders. Anything matched that is not
    // a formatting chord falls through to the window listener in Workspace.
    const shortcut = matchShortcut(event, { typing: true });
    switch (shortcut?.id) {
      case "format-bold":
        event.preventDefault();
        applyWrap("**");
        return;
      case "format-italic":
        // The renderer parses *x* and _x_ alike; `_` is what survives sitting
        // directly inside a ** wrap.
        event.preventDefault();
        applyWrap("_");
        return;
      case "format-code":
        event.preventDefault();
        toggleCode();
        return;
      case "format-strike":
        event.preventDefault();
        applyWrap("~~");
        return;
    }

    // Commands, then mentions, then emoji — the order they can open in.
    if (slash.handleKey(event)) return;
    if (mentions.handleKey(event)) return;
    if (emoji.handleKey(event)) return;

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
  const mentionsOpen =
    mentions.query !== null && mentions.candidates.length > 0;

  return (
    <div className="composer">
      <div
        className="composer-wrap"
        data-dragging={files.dragging}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          files.setDragging(true);
        }}
        onDragLeave={(event) => {
          // Moving between children fires dragleave; only the real exit counts.
          if (event.currentTarget.contains(event.relatedTarget as Node | null))
            return;
          files.setDragging(false);
        }}
        onDrop={files.onDrop}
      >
        {mentionsOpen && (
          <MentionOptions
            candidates={mentions.candidates}
            index={mentions.index}
            onPick={mentions.apply}
          />
        )}

        {emoji.query !== null && emoji.candidates.length > 0 && (
          <EmojiOptions
            candidates={emoji.candidates}
            index={emoji.index}
            onPick={emoji.apply}
          />
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

        {slash.matches.length > 0 && (
          <CommandOptions
            matches={slash.matches}
            index={slash.index}
            onPick={slash.apply}
          />
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
          <FormatToolbar onWrap={applyWrap} onCode={toggleCode} />

          <AttachmentTray attachments={attachments} onDiscard={files.discard} />

          <textarea
            ref={textareaRef}
            className="composer-input"
            name="message"
            value={draft}
            placeholder={placeholder}
            rows={2}
            onChange={(e) => updateDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={files.onPaste}
            aria-label={placeholder}
            // Only while the list is open. This stays a message field — it is not
            // relabelled a combobox, because that is what it is for ninety-nine
            // keystrokes in a hundred and a textarea announced as a combobox all the
            // time is a worse trade than a silent list some of the time.
            aria-controls={mentionsOpen ? "mention-options" : undefined}
            aria-activedescendant={
              mentionsOpen ? `mention-option-${mentions.index}` : undefined
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
                files.attach(Array.from(event.target.files ?? []));
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
            <span className="grow" />
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
            <SchedulePicker
              disabled={!ready || sending}
              holdingFiles={attachments.length > 0}
              onSchedule={scheduleFor}
            />
          </div>
        </div>

        {error && <p className="error-text composer-error">{error}</p>}
      </div>
    </div>
  );
}
