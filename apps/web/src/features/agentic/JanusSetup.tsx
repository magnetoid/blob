/** What to do with the token a Janus agent was just given.
 *
 * The sibling of `DesktopAgentSetup`, and deliberately not the same component: that one
 * teaches the bridge — a second process that holds Blob's socket and speaks AG-UI to an
 * agent beside it — and Janus needs none of it. Janus speaks Blob's socket protocol
 * itself (`gateway/platforms/blob.py` in its repository), so the whole setup is two
 * environment variables and a restart. A page that printed the bridge instructions for
 * a Janus agent would have people downloading a script they must not run.
 *
 * The token is written into the block verbatim, for the reason `DesktopAgentSetup`
 * gives: it is on screen one line above, this is the moment it is meant to be copied,
 * and a placeholder that has to be substituted by hand is the step people get wrong.
 */

import { useState } from 'react';

interface Props {
  agentName: string;
  botToken: string;
}

export function JanusSetup({ agentName, botToken }: Props) {
  const [tab, setTab] = useState<'env' | 'yaml'>('env');
  const [copied, setCopied] = useState(false);

  const env = [
    `export BLOB_URL=${window.location.origin}`,
    `export BLOB_BOT_TOKEN=${botToken}`,
    `export BLOB_AGENT_NAME=${JSON.stringify(agentName)}`,
    '',
    'janus gateway start',
  ].join('\n');

  const yaml = [
    '# ~/.janus/config.yaml',
    'platforms:',
    '  blob:',
    '    enabled: true',
    `    token: ${botToken}`,
    '    extra:',
    `      url: ${window.location.origin}`,
    `      name: ${JSON.stringify(agentName)}`,
  ].join('\n');

  const block = tab === 'env' ? env : yaml;

  async function copy() {
    try {
      await navigator.clipboard.writeText(block);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The block is on screen and selectable; a clipboard the browser withholds is
      // not worth an error.
    }
  }

  return (
    <div className="admin-secret-card block" data-testid="janus-setup">
      <div className="admin-row-title">Point {agentName} at this workspace</div>
      <div className="admin-row-meta" style={{ marginBottom: 12 }}>
        Janus dials Blob and holds the connection itself — no bridge script, no signing
        secret, no public address. Give it these two values where it runs, on a laptop or
        a server, and start the gateway.
      </div>

      <div className="chip-row" aria-label="How to configure Janus">
        <button
          type="button"
          className="chip"
          aria-pressed={tab === 'env'}
          onClick={() => setTab('env')}
        >
          Environment
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={tab === 'yaml'}
          onClick={() => setTab('yaml')}
        >
          config.yaml
        </button>
      </div>

      <pre className="admin-command-block">
        <code>{block}</code>
      </pre>

      <button className="btn btn-ghost" onClick={() => void copy()}>
        {copied ? 'Copied' : tab === 'env' ? 'Copy these commands' : 'Copy this config'}
      </button>

      <p className="pref-hint" style={{ margin: '10px 0 0' }}>
        <code>janus gateway status</code> should then say <strong>Blob: connected</strong>,
        and {agentName} shows as online in the table above within a minute.
      </p>

      <p className="pref-hint" style={{ margin: '10px 0 0' }}>
        <strong>Add {agentName} to a channel before you mention it.</strong> Mentioning it
        somewhere it has not been added looks identical to it being offline — it stays
        silent rather than saying it cannot see the conversation.
      </p>
    </div>
  );
}
