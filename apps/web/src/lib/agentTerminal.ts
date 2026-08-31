/**
 * Opening a terminal in the agent a DM is with.
 *
 * The `/cli` half that is not parsing: ask the server which agent this conversation is
 * with, then put it in the store for the shell to render. Split out of the composer
 * because the composer's job is a message, and because the refusal path is the
 * interesting one — most agents are not ones Blob hosts, and "nothing happened" is the
 * wrong way to say so.
 */

import { api } from './api.ts';
import { useStore } from './store.ts';
import { showError } from './toasts.ts';

export async function openAgentTerminal(botUserId: string): Promise<void> {
  try {
    const target = await api.agents.terminalTarget(botUserId);
    useStore.setState({
      terminalTarget: { pluginId: target.pluginId, agentName: target.agentName },
      // A terminal and a thread share the one panel column, so opening one closes the
      // other rather than leaving the shell to decide which it meant.
      activeThreadRootId: null,
    });
  } catch (err) {
    // The server's own sentence, which names the reason: an agent Blob does not host
    // has no container to open, and that is a different problem from a refusal.
    showError(err);
  }
}

export function closeAgentTerminal(): void {
  useStore.setState({ terminalTarget: null });
}
