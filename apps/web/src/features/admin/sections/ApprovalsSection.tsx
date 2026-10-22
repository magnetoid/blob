/** Admin → Approvals: what agents are waiting on across the workspace — a decision nobody
 *  has made yet, and a run that said it would come back (ADR 0040). Every one is listed,
 *  oldest first, as the run log lists every run; what it asks or notes, Open and Stop, only
 *  where you can read the room — a private room's words stay in it. */

import { api, type PendingApproval } from '../../../lib/api.ts';
import { formatMoment } from '../../../lib/format.ts';
import { showChannel } from '../../../lib/navigation.ts';
import { showError } from '../../../lib/toasts.ts';
import { useFetch } from '../../../lib/useFetch.ts';
import { formatRelative } from '../../messages/messageFormatting.ts';
import { Card, CardNotice } from '../../console/Card.tsx';

function waitingFor(item: PendingApproval): string {
  const { run } = item;
  if (run.status === 'waiting') {
    return run.comesBackAt
      ? `coming back ${formatMoment(run.comesBackAt)}`
      : `waiting for ${run.askedAgent ?? 'another agent'}`;
  }
  return `waiting for ${item.personName ?? 'somebody'}’s answer`;
}

function where(item: PendingApproval): string {
  if (item.channelName) return `#${item.channelName}`;
  return item.channelKind === 'group_dm' ? 'a group message' : 'a direct message';
}

/** What it asks, or what it will come back to do — the room's own words. */
function words(item: PendingApproval): string | null {
  if (!item.visible) return null;
  return item.run.comesBackFor ?? item.run.decision?.prompt ?? null;
}

export function ApprovalsSection() {
  const { data, reload } = useFetch(async () => (await api.admin.pendingApprovals()).pending, [], {
    onError: showError,
  });

  async function stop(item: PendingApproval) {
    try {
      await api.agentRuns.cancel(item.run.id);
      reload();
    } catch (err) {
      showError(err);
    }
  }

  if (!data) {
    return (
      <div className="console-stack">
        <Card>
          <CardNotice>Loading…</CardNotice>
        </Card>
      </div>
    );
  }
  return (
    <div className="console-stack">
      <Card
        title="Waiting"
        description="Questions agents asked that nobody has answered yet, and the runs that said they would come back. Only the person a question is for can answer it, where it was asked."
      >
        {data.length === 0 ? (
          <CardNotice>Nothing is waiting on anybody.</CardNotice>
        ) : (
          <ul className="hold-list" aria-label="What agents are waiting on">
            {data.map((item) => {
              const said = words(item);
              const since = item.run.finishedAt ?? item.run.startedAt;
              return (
                <li key={item.run.id} className="hold-row approval-row">
                  <span className="grow min-0">
                    <span className="pref-label">
                      {item.run.agentName}, {waitingFor(item)}
                    </span>
                    <span className="pref-hint block">
                      In {where(item)} · since {formatRelative(since)}
                    </span>
                    {said && <span className="pref-hint block approval-words">“{said}”</span>}
                    {!item.visible && (
                      <span className="pref-hint block">
                        In a conversation you are not in: what it asks stays there.
                      </span>
                    )}
                  </span>
                  {item.visible && (
                    <span className="approval-actions">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void showChannel(item.run.channelId)}
                      >
                        Open
                      </button>
                      <button type="button" className="btn" onClick={() => void stop(item)}>
                        Stop
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
