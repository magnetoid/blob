/** The summary card: what a model (or the keyword scan) made of the thread. */

import { useState } from "react";
import type { ThreadSummary as Summary, User } from "@blob/shared";
import { api } from "../../lib/api.ts";
import { showError } from "../../lib/toasts.ts";
import { showMessage } from "../../lib/navigation.ts";
import { renderInline, renderMarkdown, type RenderOptions } from "../../lib/markdown.tsx";
import { errorMessage, formatWhen } from "./threadTools.ts";

/** `llm:<model>` is the model; anything else is the keyword scan the server falls back to. */
function isModelWritten(summary: Summary): boolean {
  return summary.provider.startsWith("llm:");
}

function providerLabel(provider: string): string {
  if (provider.startsWith("llm:")) {
    const model = provider.slice("llm:".length);
    return model ? `AI summary · ${model}` : "AI summary";
  }
  return "Keyword scan";
}

/** The message a line rests on, one press away — a summary you can check is one you can trust. */
function Cite({ messageId }: { messageId: string | null }) {
  if (!messageId) return null;
  return (
    <button
      type="button"
      className="summary-cite"
      title="Go to the message"
      aria-label="Go to the message"
      onClick={() =>
        void showMessage(messageId).then((shown) => {
          if (!shown) showError(new Error("That message is no longer there."));
        })
      }
    >
      ↗
    </button>
  );
}

export function ThreadSummaryCard({
  rootId,
  summary,
  loading,
  error,
  renderOptions,
  users,
  onRefreshed,
}: {
  rootId: string;
  summary: Summary | null;
  loading: boolean;
  error: string | null;
  renderOptions: RenderOptions;
  users: Record<string, User>;
  onRefreshed: (summary: Summary | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setRefreshError(null);
    try {
      const result = await api.agentic.refreshThreadSummary(rootId);
      onRefreshed(result.summary);
    } catch (err) {
      setRefreshError(errorMessage(err, "Could not refresh the thread summary."));
    } finally {
      setBusy(false);
    }
  }

  const shown = refreshError ?? error;
  return (
    <section
      className="agentic-card"
      /* Iris means "an agent wrote this", so only the model-written summary
         gets it. `heuristic-v1` is Blob's own keyword scan running because no
         model is configured — marking that as agent output would claim a
         teammate where there is only a stopgap. */
      data-written-by={summary && isModelWritten(summary) ? "model" : undefined}
      aria-labelledby="thread-summary-title"
    >
      <div className="agentic-head">
        <div>
          <div className="agentic-kicker">
            {summary && isModelWritten(summary) ? "AI summary" : "Summary"}
          </div>
          <h3 className="agentic-title" id="thread-summary-title">
            Catch up without rereading
          </h3>
        </div>
        <button
          className="btn"
          onClick={() => void refresh()}
          disabled={busy}
        >
          {busy ? "Working…" : summary ? "Refresh" : "Generate"}
        </button>
      </div>

      {loading ? (
        <div className="agentic-empty">Loading summary…</div>
      ) : summary ? (
        <div className="agentic-body">
          <div className="summary-overview">
            {renderMarkdown(summary.overview, renderOptions)}
          </div>
          <div className="summary-meta">
            {providerLabel(summary.provider)} · {summary.messageCount} messages
            · updated {formatWhen(summary.updatedAt)}
            {isModelWritten(summary) && " · check the sources"}
          </div>

          {summary.decisions.length > 0 && (
            <div>
              <div className="agentic-list-title">Decisions</div>
              <ul className="agentic-list">
                {summary.decisions.map((item, index) => (
                  <li key={`${item.messageId ?? "decision"}-${index}`}>
                    {renderInline(item.text, renderOptions)}
                    <Cite messageId={item.messageId} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.actionItems.length > 0 && (
            <div>
              <div className="agentic-list-title">Action items</div>
              <ul className="agentic-list">
                {summary.actionItems.map((item, index) => (
                  <li key={`${item.sourceMessageId ?? "action"}-${index}`}>
                    {renderInline(item.text, renderOptions)}
                    <Cite messageId={item.sourceMessageId} />
                    {item.assigneeUserId && (
                      <span className="agentic-inline-meta">
                        {" "}
                        ·{" "}
                        {users[item.assigneeUserId]?.displayName ??
                          "Assigned"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.openQuestions.length > 0 && (
            <div>
              <div className="agentic-list-title">Open questions</div>
              <ul className="agentic-list">
                {summary.openQuestions.map((item, index) => (
                  <li key={`${item.messageId ?? "question"}-${index}`}>
                    {renderInline(item.text, renderOptions)}
                    <Cite messageId={item.messageId} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="agentic-empty">
          No summary yet. Generate one to pull out the decisions, the action
          items and the questions nobody answered.
        </div>
      )}

      {shown && <div className="error-text">{shown}</div>}
    </section>

  );
}
