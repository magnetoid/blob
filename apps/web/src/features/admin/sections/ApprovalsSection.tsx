/** Admin → Approvals: what agents are waiting on across the workspace — a decision nobody
 *  has made yet, and a run that said it would come back (ADR 0040). Every one is listed,
 *  oldest first, as the run log lists every run; what it asks or notes, Open and Stop, only
 *  where you can read the room — a private room's words stay in it. */

import { api, type PendingApproval } from '../../../lib/api.ts';
import { formatMoment } from '../../../lib/format.ts';
import { showChannel } from '../../../lib/navigation.ts';
import { showError } from '../../../lib/toasts.ts';
import { useFetch } from '../../../lib/useFetch.ts';
import { Button } from '../../../components/ui/button.tsx';
import {
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '../../../components/ui/item.tsx';
import { formatRelative } from '../../messages/messageFormatting.ts';
import { Card, CardNotice, CardRow, CardRows } from '../../console/Card.tsx';

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
      <div className="flex flex-col gap-6">
        <Card>
          <CardNotice>Loading…</CardNotice>
        </Card>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Waiting"
        description="Only the person a question is for can answer it, in the conversation where it was asked."
      >
        {data.length === 0 ? (
          <CardNotice>Nothing is waiting on anybody.</CardNotice>
        ) : (
          <CardRows aria-label="What agents are waiting on">
            {data.map((item) => {
              const said = words(item);
              const since = item.run.finishedAt ?? item.run.startedAt;
              return (
                <CardRow key={item.run.id}>
                  <ItemContent>
                    <ItemTitle>
                      {item.run.agentName}, {waitingFor(item)}
                    </ItemTitle>
                    <ItemDescription>
                      In {where(item)} · since {formatRelative(since)}
                    </ItemDescription>
                    {said && (
                      <ItemDescription className="text-foreground wrap-anywhere">
                        “{said}”
                      </ItemDescription>
                    )}
                    {!item.visible && (
                      <ItemDescription>
                        In a conversation you are not in: what it asks stays there.
                      </ItemDescription>
                    )}
                  </ItemContent>
                  {item.visible && (
                    <ItemActions>
                      {/* Every row has an Open and a Stop, so each says whose it is. */}
                      <Button
                        variant="outline"
                        aria-label={`Open ${where(item)}`}
                        onClick={() => void showChannel(item.run.channelId)}
                      >
                        Open
                      </Button>
                      <Button
                        variant="outline"
                        aria-label={`Stop ${item.run.agentName}`}
                        onClick={() => void stop(item)}
                      >
                        Stop
                      </Button>
                    </ItemActions>
                  )}
                </CardRow>
              );
            })}
          </CardRows>
        )}
      </Card>
    </div>
  );
}
