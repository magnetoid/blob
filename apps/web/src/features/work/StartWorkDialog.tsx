/** Turn a message into a place to build what it asks for.
 *
 * From a message's menu: name the assignment, choose which agents come along, and Blob
 * spins a private channel that quotes this message, links back to it from its thread, and
 * mentions the agents so they start on your authority. The agents on offer are the bots in
 * the workspace; one that is somebody else's is refused by the server with a sentence, and
 * that is the right place for the rule to live.
 */

import { useEffect, useRef, useState } from "react";
import type { Message } from "@blob/shared";
import { api, type WorkspaceAgent } from "../../lib/api.ts";
import { showChannel } from "../../lib/navigation.ts";
import { showError } from "../../lib/toasts.ts";
import { trapFocus } from "../../lib/focusTrap.ts";
import { useEscape } from "../../lib/useEscape.ts";

interface Props {
  message: Message;
  onClose: () => void;
}

const TITLE_MAX = 200;

import { suggestedTitle } from "./title.ts";

export function StartWorkDialog({ message, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useEffect(() => trapFocus(dialogRef.current), []);

  // The agents a member may bring: the workspace's own, and theirs. The server is the
  // authority on that list, so it is fetched rather than derived from the user map.
  const [bots, setBots] = useState<WorkspaceAgent[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState(() => suggestedTitle(message.body));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.agents
      .list()
      .then((listed) => {
        if (cancelled) return;
        setBots(listed.agents);
        // Agents already mentioned in the message are the obvious ones to bring.
        const mentioned = new Set(message.mentionUserIds ?? []);
        setChosen(
          new Set(
            listed.agents
              .filter((a) => mentioned.has(a.botUserId))
              .map((a) => a.id),
          ),
        );
      })
      .catch(showError);
    return () => {
      cancelled = true;
    };
  }, [message.id, message.mentionUserIds]);

  async function start() {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const started = await api.work.start({
        rootMessageId: message.id,
        title: title.trim().slice(0, TITLE_MAX),
        agentPluginIds: [...chosen],
      });
      onClose();
      await showChannel(started.work.channelId);
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Start work from this message"
        tabIndex={-1}
      >
        <h2 className="dialog-title">Start work from here</h2>
        <p className="pref-hint" style={{ marginTop: 0 }}>
          A private channel for this one job. It quotes this message, links back
          to it, and the agents you bring start on your say‑so.
        </p>

        <label className="field">
          <span className="field-label">What is the work?</span>
          <input
            className="input"
            name="work-title"
            value={title}
            maxLength={TITLE_MAX}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void start();
            }}
          />
        </label>

        <fieldset className="admin-scope-list">
          <legend className="field-label">Bring</legend>
          {bots.length === 0 && (
            <span className="pref-hint">No agents are installed here yet.</span>
          )}
          {bots.map((bot) => (
            <label key={bot.id} className="admin-scope-row">
              <input
                type="checkbox"
                checked={chosen.has(bot.id)}
                onChange={() =>
                  setChosen((current) => {
                    const next = new Set(current);
                    if (next.has(bot.id)) next.delete(bot.id);
                    else next.add(bot.id);
                    return next;
                  })
                }
              />
              <span>
                {bot.name}
                {bot.mine ? " · yours" : ""}
              </span>
            </label>
          ))}
        </fieldset>

        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!title.trim() || busy}
            onClick={() => void start()}
          >
            {busy ? "Starting…" : "Start work"}
          </button>
        </div>
      </div>
    </div>
  );
}
