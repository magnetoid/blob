/** Turn a message into a place to build what it asks for.
 *
 * From a message's menu: name the assignment, choose which agents come along, and Blob
 * spins a private channel that quotes this message, links back to it from its thread, and
 * mentions the agents so they start on your authority. The agents on offer are the bots in
 * the workspace; one that is somebody else's is refused by the server with a sentence, and
 * that is the right place for the rule to live.
 */

import { useMemo, useState } from "react";
import type { Message } from "@blob/shared";
import { api, type WorkspaceAgent } from "../../lib/api.ts";
import { showChannel } from "../../lib/navigation.ts";
import { showError } from "../../lib/toasts.ts";

interface Props {
  message: Message;
  onClose: () => void;
}

const TITLE_MAX = 200;

import { suggestedTitle } from "./title.ts";
import { Dialog } from "../../components/Dialog.tsx";
import { useFetch } from "../../lib/useFetch.ts";

export function StartWorkDialog({ message, onClose }: Props) {

  // The agents a member may bring: the workspace's own, and theirs. The server is the
  // authority on that list, so it is fetched rather than derived from the user map.
  const { data: bots } = useFetch(
    async (): Promise<WorkspaceAgent[]> => (await api.agents.list()).agents,
    [],
    { onError: showError },
  );
  // Agents already mentioned in the message are the obvious ones to bring — until the
  // person ticks something, which is what `picked` holds. Derived rather than copied
  // into state when the list arrives, so there is no render that has the list and not
  // yet the selection.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = useMemo(() => {
    if (picked) return picked;
    const mentioned = new Set(message.mentionUserIds ?? []);
    return new Set((bots ?? []).filter((a) => mentioned.has(a.botUserId)).map((a) => a.id));
  }, [picked, bots, message.mentionUserIds]);
  const [title, setTitle] = useState(() => suggestedTitle(message.body));
  const [busy, setBusy] = useState(false);

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
    <Dialog label="Start work from this message" onClose={onClose}>
      <div className="dialog">
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
          {bots?.length === 0 && (
            <span className="pref-hint">No agents are installed here yet.</span>
          )}
          {(bots ?? []).map((bot) => (
            <label key={bot.id} className="admin-scope-row">
              <input
                type="checkbox"
                checked={chosen.has(bot.id)}
                onChange={() => {
                  const next = new Set(chosen);
                  if (next.has(bot.id)) next.delete(bot.id);
                  else next.add(bot.id);
                  setPicked(next);
                }}
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
    </Dialog>
  );
}
