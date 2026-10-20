/** The decision log: what conversations settled, and where (M2 · A8).
 *
 * "A thread that reaches a decision leaves a decision behind." This is where they are
 * found again: newest first, each with the conversation it was made in — one press back to
 * the message it rests on — who decided, the agent that proposed it if one did, and why.
 * It lists what the server lets this person read, which is the channels they are in, so a
 * private channel's decisions appear only to its members.
 *
 * A decision that no longer stands is kept, struck through, and hidden until asked for:
 * how a team got where it is includes what it stopped deciding. Its recorder or an admin
 * rewords or revokes it here; everybody else reads.
 */

import { useCallback, useMemo, useState } from "react";
import type { Decision } from "@blob/shared";
import { api } from "../../lib/api.ts";
import { useStore } from "../../lib/store.ts";
import { useFetch } from "../../lib/useFetch.ts";
import { showChannel, showMessage } from "../../lib/navigation.ts";
import { showError } from "../../lib/toasts.ts";
import { DialogPresence } from "../../components/Dialog.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { ListSkeleton } from "../../components/ListSkeleton.tsx";
import { DecisionIcon } from "../../components/Icon.tsx";
import { formatRelative } from "../messages/messageFormatting.ts";
import { DecisionDialog } from "./DecisionDialog.tsx";

interface Page {
  decisions: Decision[];
  nextBefore: string | null;
}

export function DecisionsView() {
  const me = useStore((s) => s.currentUser);
  const channels = useStore((s) => s.channels);
  const [query, setQuery] = useState("");
  const [channelId, setChannelId] = useState("");
  const [showRevoked, setShowRevoked] = useState(false);
  const [older, setOlder] = useState<Decision[]>([]);
  const [olderBefore, setOlderBefore] = useState<string | null>(null);
  const [editing, setEditing] = useState<Decision | null>(null);

  const load = useCallback(async (): Promise<Page> => {
    const page = await api.decisions.list({
      q: query.trim() || undefined,
      channelId: channelId || undefined,
      revoked: showRevoked,
    });
    setOlder([]);
    setOlderBefore(page.nextBefore ?? null);
    return { decisions: page.decisions, nextBefore: page.nextBefore ?? null };
  }, [query, channelId, showRevoked]);
  const { data, error, reload } = useFetch(load, [load], { debounceMs: 250 });

  const rows = useMemo(() => [...(data?.decisions ?? []), ...older], [data, older]);
  const named = useMemo(
    () =>
      Object.values(channels)
        .filter((c) => c.name && !c.archivedAt)
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    [channels],
  );
  const isAdmin = me?.role === "admin" || me?.role === "owner";
  const filtered = Boolean(query.trim() || channelId);

  async function more() {
    if (!olderBefore) return;
    try {
      const page = await api.decisions.list({
        q: query.trim() || undefined,
        channelId: channelId || undefined,
        revoked: showRevoked,
        before: olderBefore,
      });
      setOlder((now) => [...now, ...page.decisions]);
      setOlderBefore(page.nextBefore ?? null);
    } catch (err) {
      showError(err);
    }
  }

  async function revoke(decision: Decision) {
    try {
      await api.decisions.revoke(decision.id, decision.revokedAt === null);
      reload();
    } catch (err) {
      showError(err);
    }
  }

  return (
    <main className="pane">
      <header className="pane-header">
        <div className="min-0">
          <div className="pane-heading">
            <h1 className="pane-title">Decisions</h1>
          </div>
          <div className="pane-sub">
            What the team settled, each one kept with the conversation it was made in
          </div>
        </div>
      </header>

      <div className="decisions-filters" role="search">
        <input
          className="input"
          type="search"
          placeholder="Find a decision"
          aria-label="Find a decision"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="input"
          aria-label="Conversation"
          value={channelId}
          onChange={(event) => setChannelId(event.target.value)}
        >
          <option value="">Every conversation</option>
          {named.map((channel) => (
            <option key={channel.id} value={channel.id}>
              #{channel.name}
            </option>
          ))}
        </select>
        <label className="decisions-revoked">
          <input
            type="checkbox"
            checked={showRevoked}
            onChange={(event) => setShowRevoked(event.target.checked)}
          />
          Include ones that no longer stand
        </label>
      </div>

      <div className="search-results">
        {error && <p className="error-text">The decisions could not be loaded.</p>}
        {!error && data === null && <ListSkeleton rows={3} />}

        {data && rows.length === 0 && (
          <EmptyState mark={<DecisionIcon size="xl" />} title={filtered ? "Nothing matches" : "Nothing decided yet"}>
            {filtered
              ? "No decision in the conversations you are in says that."
              : "When a conversation settles something, record it from the message's menu, from a thread's summary, or by typing /decision. It will be kept here, with the message it came from."}
          </EmptyState>
        )}

        {rows.length > 0 && (
          <ul className="decision-list" aria-label="Decisions">
            {rows.map((decision) => (
              <DecisionRow
                key={decision.id}
                decision={decision}
                mayChange={isAdmin || decision.decidedBy === me?.id}
                onEdit={() => setEditing(decision)}
                onRevoke={() => void revoke(decision)}
              />
            ))}
          </ul>
        )}

        {olderBefore && rows.length > 0 && (
          <div className="decisions-more">
            <button className="btn btn-ghost" onClick={() => void more()}>
              Show older decisions
            </button>
          </div>
        )}
      </div>

      <DialogPresence when={editing}>
        {(decision) => (
          <DecisionDialog
            heading="Change the decision"
            initialTitle={decision.title}
            initialRationale={decision.rationale}
            saveLabel="Save"
            onSave={async (title, rationale) => {
              await api.decisions.change(decision.id, { title, rationale });
              reload();
            }}
            onClose={() => setEditing(null)}
          />
        )}
      </DialogPresence>
    </main>
  );
}

function DecisionRow({
  decision,
  mayChange,
  onEdit,
  onRevoke,
}: {
  decision: Decision;
  mayChange: boolean;
  onEdit: () => void;
  onRevoke: () => void;
}) {
  const decider = useStore((s) => (decision.decidedBy ? s.users[decision.decidedBy] : undefined));
  const channel = useStore((s) => s.channels[decision.channelId]);
  const channelTitle = useStore((s) => s.channelTitle);
  const where = decision.channelName
    ? `#${decision.channelName}`
    : channel
      ? channelTitle(channel)
      : "a conversation";
  const standing = decision.revokedAt === null;

  function open() {
    if (decision.messageId) {
      void showMessage(decision.messageId).then((shown) => {
        if (!shown) showError(new Error("That message is no longer there."));
      });
    } else {
      void showChannel(decision.channelId);
    }
  }

  return (
    <li className="decision-row" data-standing={standing}>
      <span className="decision-mark" aria-hidden="true">
        <DecisionIcon size="sm" />
      </span>
      <div className="grow min-0">
        <div className="decision-title">{decision.title}</div>
        {decision.rationale && <p className="decision-why">{decision.rationale}</p>}
        <div className="decision-meta">
          <button className="decision-where" onClick={open}>
            {where}
          </button>
          <span>
            {" "}
            · decided by {decider?.displayName ?? "somebody no longer here"}
            {decision.proposedByName ? `, proposed by ${decision.proposedByName}` : ""} ·{" "}
            {formatRelative(decision.createdAt)}
            {standing ? "" : " · no longer stands"}
          </span>
        </div>
      </div>
      {mayChange && (
        <div className="decision-actions">
          <button className="btn btn-ghost" onClick={onEdit}>
            Edit
          </button>
          <button className="btn btn-ghost" onClick={onRevoke}>
            {standing ? "Revoke" : "Restore"}
          </button>
        </div>
      )}
    </li>
  );
}
