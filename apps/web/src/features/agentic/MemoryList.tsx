/** What agents remember, one conversation a row (migration 0050).
 *
 * Shared by the two places a memory can be seen and cleared: Settings, where a person
 * sees what agents they own or borrow remember of their own conversations, and an
 * agent's console page, where an admin sees what it remembers of conversations they can
 * see. Each row is where, when it was last written, how much, the start of it as the
 * agent left it — and Forget, which the agent's next run there feels as a cold start.
 */

import type { AgentMemory } from '../../lib/api.ts';
import { formatBytes } from '../../lib/format.ts';
import { useStore } from '../../lib/store.ts';
import { formatRelative } from '../messages/messageFormatting.ts';

/** The preview as the agent's JSON, indented — or as it came, when the preview cut it. */
function shown(preview: string): string {
  try {
    return JSON.stringify(JSON.parse(preview), null, 2);
  } catch {
    return `${preview}…`;
  }
}

export function MemoryList({
  memories,
  showAgent,
  busy = false,
  onForget,
}: {
  memories: AgentMemory[];
  /** Name the agent on each row — Settings lists several agents' memories at once. */
  showAgent: boolean;
  busy?: boolean;
  onForget: (memory: AgentMemory) => void;
}) {
  const channels = useStore((s) => s.channels);
  const channelTitle = useStore((s) => s.channelTitle);

  return (
    <div className="console-list">
      {memories.map((memory) => {
        const channel = channels[memory.channelId];
        const where = channel
          ? channelTitle(channel)
          : memory.channelName
            ? `#${memory.channelName}`
            : 'a conversation';
        return (
          <div className="console-list-item" key={memory.id}>
            <div className="admin-row">
              <div className="grow min-0">
                <div className="admin-row-title">
                  {showAgent && `${memory.agentName} · `}
                  {memory.inThread ? `a thread in ${where}` : where}
                </div>
                <div className="admin-row-meta">
                  written {formatRelative(memory.updatedAt)} · {formatBytes(memory.size)}
                </div>
                <details className="memory-preview">
                  <summary>What it remembers</summary>
                  <pre className="agent-run-io">{shown(memory.preview)}</pre>
                </details>
              </div>
              <div className="admin-row-actions">
                <button className="btn btn-ghost" disabled={busy} onClick={() => onForget(memory)}>
                  Forget
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
