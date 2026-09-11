/** What to actually do with the token a desktop agent was just given.
 *
 * Registering a socket agent hands back a bot token and, until this existed, nothing
 * else — a 40-character secret and no statement of what to paste it into. The agent
 * "does not exist yet" by design: it becomes real when something connects with that
 * token. So the screen that mints it is the only place that can say how.
 *
 * Two steps, because there are genuinely two: fetch the bridge, then run it. The fetch is
 * a link rather than a `curl` line on purpose — the route is admin-only and authenticated
 * by the session cookie, which the browser has and a terminal on another machine does
 * not. A copyable `curl` would fail with a 401 for everyone who tried it.
 *
 * The token is written into the command block verbatim. It is already on screen one line
 * above, this is the moment it is meant to be copied, and a placeholder that has to be
 * substituted by hand is the step people get wrong.
 */

import { useState } from 'react';

interface Props {
  agentName: string;
  botToken: string;
  /** The secret the bridge signs runs with, and the agent verifies them against. */
  signingSecret: string | null;
  /** Where to fetch the bridge from. The admin route by default; a member has their own. */
  bridgeHref?: string;
}

/** Where Janus serves AG-UI when it runs locally. Any AG-UI server works; this is the
 * one the person asking is most likely to be running. */
const DEFAULT_AGENT_URL = 'http://127.0.0.1:8642/v1/agui';

export function DesktopAgentSetup({
  agentName,
  botToken,
  signingSecret,
  bridgeHref = '/api/admin/plugins/bridge',
}: Props) {
  const [agentUrl, setAgentUrl] = useState(DEFAULT_AGENT_URL);
  const [copied, setCopied] = useState(false);

  const command = [
    `export BLOB_URL=${window.location.origin}`,
    `export BLOB_BOT_TOKEN=${botToken}`,
    // Not optional in practice. The bridge signs each run with this and the agent checks
    // it; some agents will not even expose their AG-UI route without a secret configured,
    // so an omitted line here is an agent that answers nothing and says why to nobody.
    ...(signingSecret ? [`export BLOB_SIGNING_SECRET=${signingSecret}`] : []),
    `export AGENT_AGUI_URL=${agentUrl}`,
    `export AGENT_NAME=${JSON.stringify(agentName)}`,
    '',
    'pip install httpx websockets',
    'python agent_bridge.py',
  ].join('\n');

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // A clipboard the browser will not give us is not worth an error message: the
      // command is on screen and selectable.
    }
  }

  return (
    <div className="admin-secret-card" style={{ display: 'block' }}>
      <div className="admin-row-title">Connect {agentName} from your machine</div>
      <div className="admin-row-meta" style={{ marginBottom: 12 }}>
        {agentName} dials Blob and holds the connection, so it needs no public address
        and no certificate. Run this next to it — on your laptop, behind whatever router
        you like.
      </div>

      <ol className="pref-hint" style={{ margin: '0 0 12px', paddingLeft: 20 }}>
        <li style={{ marginBottom: 8 }}>
          <a
            className="btn btn-ghost"
            href={bridgeHref}
            download="agent_bridge.py"
          >
            Download agent_bridge.py
          </a>
          <span style={{ marginLeft: 8 }}>
            and put it beside the agent. It needs Python 3.11+.
          </span>
        </li>
        <li>
          <label className="pref-label" htmlFor="agent-agui-url">
            Where the agent serves AG-UI locally
          </label>
          <input
            id="agent-agui-url"
            className="input"
            value={agentUrl}
            onChange={(event) => setAgentUrl(event.target.value)}
            spellCheck={false}
          />
        </li>
      </ol>

      <pre className="admin-command-block">
        <code>{command}</code>
      </pre>

      <button className="btn btn-ghost" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy these commands'}
      </button>

      <p className="pref-hint" style={{ margin: '10px 0 0' }}>
        Leave it running. It reconnects on its own when the machine wakes or the network
        changes, and the agent answers whenever it is mentioned.
      </p>

      {/* The one thing that makes a correctly-connected agent look broken. Mentions
          resolve by handle across the whole workspace, so `@name` in a channel the bot
          has not joined starts a run that stops at the access check and says nothing at
          all — no message, no error, not even a row in the run log. Anyone who hits it
          concludes the feature does not work. */}
      <p className="pref-hint" style={{ margin: '10px 0 0' }}>
        <strong>Add {agentName} to a channel before you mention it.</strong> Open the
        agent's <em>Channels</em> tab below. Mentioning it somewhere it has not been added
        looks identical to it being offline — it stays silent rather than telling you it
        cannot see the conversation.
      </p>
    </div>
  );
}
