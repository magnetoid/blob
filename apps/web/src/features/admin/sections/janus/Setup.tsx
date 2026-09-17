/** What to set when this stack has no Janus.
 *
 * The sibling of `features/agentic/JanusSetup.tsx` and deliberately the other half of
 * it: that one tells an agent where Blob is, this one tells Blob where the agent is.
 * Four lines, on the machine Blob runs on — Blob ships no agent of its own, so until
 * they are set there is nothing to configure and this page would otherwise be blank.
 *
 * Nothing here is a value: the two secrets are named, never shown. Blob does not hold
 * them to show — they are the environment's, and the page that reads Janus's own
 * configuration never receives a key back either.
 */

import type { JanusOverview } from "../../../../lib/api.ts";

/** Janus's image tag, as `.env.example` and both compose files pin it. */
const JANUS_VERSION = "0.17.0";

const LINES = [
  {
    name: "JANUS_AGUI_URL",
    text: "JANUS_AGUI_URL=http://janus:8642/v1/agui",
    hint: "Where Blob calls a run. Internal: the service needs no published port.",
  },
  {
    name: "JANUS_SIGNING_SECRET",
    text: "JANUS_SIGNING_SECRET=<the same secret the janus service reads as BLOB_SIGNING_SECRET>",
    hint: "Signs every run. A mismatch is a 401 that looks exactly like the agent being down.",
  },
  {
    name: "JANUS_API_SERVER_KEY",
    text: "JANUS_API_SERVER_KEY=<the same key it reads as API_SERVER_KEY>",
    hint: "Only this page uses it — reading and changing what Janus runs on goes through its own API.",
  },
  {
    name: "JANUS_VERSION",
    text: `JANUS_VERSION=${JANUS_VERSION}`,
    hint: "Pinned rather than latest: an agent that changes under a deploy nobody made cannot be debugged from a chat message.",
  },
] as const;

export function Setup({
  overview,
  notConfigured,
}: {
  /** Null when this admin cannot read it — then nothing is marked, because nothing is known. */
  overview: JanusOverview | null;
  /** The server answered `janus_not_configured`: one of the three is unset, and it does not say which. */
  notConfigured: boolean;
}) {
  function missing(name: (typeof LINES)[number]["name"]): boolean {
    if (notConfigured) {
      // The server refuses to say which of the three is blank, so all three are named.
      // Guessing at one would send somebody to check a variable that is already set.
      return name !== "JANUS_VERSION";
    }
    if (!overview) return false;
    if (name === "JANUS_AGUI_URL") return !overview.aguiUrl;
    if (name === "JANUS_SIGNING_SECRET") return !overview.secretSet;
    // The overview only answers at all when the API key is set, so reaching here is
    // proof of it.
    return false;
  }

  return (
    <div className="admin-secret-card block">
      {/* Two states, and only one of them is a fault. The server saying
          `janus_not_configured` means the stack has no Janus at all; a workspace merely
          without the row is seeded on the next start of the app, which is what `Installs`
          says a few lines below — so one headline for both read as the page contradicting
          itself. */}
      <div className="admin-row-title">
        {notConfigured ? "Janus is not running in this stack" : "This workspace has no Janus yet"}
      </div>
      <div className="admin-row-meta" style={{ marginBottom: 12 }}>
        {notConfigured ? (
          <>
            Blob ships no agent of its own. Janus runs beside it as its own service, and a
            workspace gets it through the ordinary install path once Blob has been told
            where it is. Set these where Blob runs — the <code>.env</code> beside the
            compose file, or the deployment's environment — and restart the app.
          </>
        ) : (
          <>
            Nothing here says the stack is broken: a workspace without the agent is seeded
            on the next start of the app, through the ordinary install path. These are the
            values it is seeded from, where Blob runs.
          </>
        )}
      </div>

      {/* Spans, not divs: a `pre` takes phrasing content, and `.block` is how the rest of
          this file already makes a line of its own. */}
      <pre className="admin-command-block">
        {LINES.map((line) => (
          <span key={line.name} className="block" data-env-line={line.name}>
            <code>{line.text}</code>
            {missing(line.name) && (
              <span className="error-text"> — not set on this server</span>
            )}
          </span>
        ))}
      </pre>

      <p className="pref-hint" style={{ margin: "10px 0 0" }}>
        {LINES.map((line) => (
          <span key={line.name} className="block">
            <strong>{line.name}</strong> — {line.hint}
          </span>
        ))}
      </p>

      <p className="pref-hint" style={{ margin: "10px 0 0" }}>
        The two secrets are shared with the <code>janus</code> service and are never
        stored in Blob. Nothing on this page shows one, or ever will.
      </p>
    </div>
  );
}
