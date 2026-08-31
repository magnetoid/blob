/** Tasks agents and teammates have filed, yours first.
 *
 * `GET /api/tasks` has existed since the agentic tables landed and
 * `api.agentic.listTasks` was called by nothing, so a task assigned to you in a thread
 * you had scrolled past was findable only by reopening that thread. Modelled on
 * ThreadsView: fetched on arrival rather than held in the store, because keeping a
 * cross-channel list fresh would mean reacting to every task event for a screen nobody
 * is looking at.
 */

import { useEffect, useState } from 'react';
import type { AgentTask } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { showChannel, showThread } from '../../lib/navigation.ts';
import { FileIcon } from '../../components/Icon.tsx';
import { formatRelative } from '../messages/messageFormatting.ts';

export function TasksView() {
  const channels = useStore((s) => s.channels);
  const channelTitle = useStore((s) => s.channelTitle);
  const currentUserId = useStore((s) => s.currentUser?.id ?? null);

  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [tasks, setTasks] = useState<AgentTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTasks(null);
    setError(null);
    void api.agentic
      .listTasks(scope === 'mine' && currentUserId ? { assignee: currentUserId } : {})
      .then((r) => {
        if (cancelled) return;
        // Yours first even in the unfiltered view; sort is stable, so the server's
        // order survives within each half.
        const mine = (t: AgentTask) => t.assigneeUserId === currentUserId;
        setTasks([...r.tasks].sort((a, b) => Number(mine(b)) - Number(mine(a))));
      })
      .catch(() => {
        if (!cancelled) setError('Those could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, [scope, currentUserId]);

  async function go(task: AgentTask) {
    // Channel first, same as ThreadsView: the thread panel renders beside its
    // conversation. A task with no thread still lives somewhere — open that channel.
    if (task.threadRootId) await showThread(task.channelId, task.threadRootId);
    else await showChannel(task.channelId);
  }

  return (
    <main className="pane">
      <header className="pane-header">
        <div style={{ minWidth: 0 }}>
          <div className="pane-heading">
            <h1 className="pane-title">Tasks</h1>
          </div>
          <div className="pane-sub">What agents and teammates have queued up</div>
        </div>
        <div className="chip-row" style={{ marginTop: 0, marginLeft: 'auto' }}>
          <button className="chip" aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>
            Mine
          </button>
          <button className="chip" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
            All
          </button>
        </div>
      </header>

      <div className="search-results">
        {error && <p className="error-text">{error}</p>}
        {!error && tasks === null && <p className="muted">Loading…</p>}

        {tasks?.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-mark">
              <FileIcon size={19} />
            </div>
            <div className="empty-state-title">No tasks yet</div>
            <div className="empty-state-body">
              When an agent or a teammate files a task {scope === 'mine' ? 'for you ' : ''}
              from a thread, it shows up here.
            </div>
          </div>
        )}

        {tasks?.map((task) => {
          const channel = channels[task.channelId];
          return (
            <button
              key={task.id}
              className="search-result"
              type="button"
              onClick={() => void go(task)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="search-result-head">
                  <span className="search-result-author">{task.title}</span>
                  <span className="search-result-meta">
                    {channel && (channel.name ? `#${channel.name}` : channelTitle(channel))}
                    {channel && ' · '}
                    {formatRelative(task.createdAt)}
                  </span>
                </div>
                <div className="search-result-meta">
                  {task.status.replace('_', ' ')} · {task.priority} priority
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </main>
  );
}
