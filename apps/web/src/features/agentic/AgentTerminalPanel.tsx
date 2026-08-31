/**
 * A terminal in the agent this DM is with, in the conversation's own panel column.
 *
 * The terminal already existed, in the console, behind Admin → Apps → the agent →
 * Deployment. That is the right place to find it when the question is "what is wrong
 * with this deployment", and the wrong one when the question is "why did you just say
 * that" — which is asked in the conversation, about the agent you are talking to. This
 * is the same component and the same socket, opened from where the question occurs.
 *
 * Nothing here re-decides who may open it. `/cli` is offered only to an admin in a DM
 * with a hosted agent, `GET /api/agents/terminal/:userId` answers before the panel
 * opens, and the socket resolves the whole gate again at connect time — the last of
 * those is the one that matters, and it is the console's.
 */

import { AgentTerminal } from '../admin/AgentTerminal.tsx';
import { CloseIcon } from '../../components/Icon.tsx';
import { closeAgentTerminal } from '../../lib/agentTerminal.ts';

interface Props {
  pluginId: string;
  agentName: string;
}

export function AgentTerminalPanel({ pluginId, agentName }: Props) {
  return (
    <aside className="panel" aria-label={`Terminal in ${agentName}`}>
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Terminal</h2>
          <div className="panel-sub">{agentName}</div>
        </div>
        <button className="icon-btn" onClick={closeAgentTerminal} title="Close terminal">
          <CloseIcon size={15} />
        </button>
      </div>
      <div className="panel-terminal">
        {/* Keyed by agent: switching DMs while a terminal is open must start a new
            session rather than hand the next agent's bytes to this one's xterm. */}
        <AgentTerminal
          key={pluginId}
          pluginId={pluginId}
          agentName={agentName}
          onClose={closeAgentTerminal}
        />
      </div>
    </aside>
  );
}
