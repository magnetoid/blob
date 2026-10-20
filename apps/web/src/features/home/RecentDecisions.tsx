/** Home's "Decided recently": the last few things conversations you are in settled (M2 · A8).
 *
 * Drawn only when there is something from the last two weeks: Home is the page of what
 * needs you, and an empty "nothing decided" card on every visit would be a card about
 * nothing. Each row goes back to the message the decision rests on; the foot opens the log.
 */

import { useStore } from '../../lib/store.ts';
import { api } from '../../lib/api.ts';
import { useFetch } from '../../lib/useFetch.ts';
import { useMinute } from '../../lib/useMinute.ts';
import { navigate } from '../../lib/router.ts';
import { showChannel, showMessage } from '../../lib/navigation.ts';
import { showError } from '../../lib/toasts.ts';
import { DecisionIcon } from '../../components/Icon.tsx';
import { formatRelative } from '../messages/messageFormatting.ts';
import type { Decision } from '@blob/shared';

const RECENT_MS = 14 * 24 * 60 * 60 * 1000;

export function RecentDecisions() {
  const me = useStore((s) => s.currentUser?.id);
  const { data } = useFetch(async () => (await api.decisions.list({ limit: 5 })).decisions, [me]);
  const now = useMinute(true);
  const recent = (data ?? [])
    .filter((decision) => now - Date.parse(decision.createdAt) < RECENT_MS)
    .slice(0, 3);
  if (recent.length === 0) return null;

  return (
    <section className="home-card home-decided">
      <h2>Decided recently</h2>
      <ul className="home-decided-list">
        {recent.map((decision) => (
          <DecidedRow key={decision.id} decision={decision} />
        ))}
      </ul>
      <div className="home-card-foot">
        <button type="button" className="home-card-link" onClick={() => navigate('/decisions')}>
          All decisions
        </button>
      </div>
    </section>
  );
}

function DecidedRow({ decision }: { decision: Decision }) {
  const where = decision.channelName ? `#${decision.channelName}` : 'a conversation';
  function open() {
    if (decision.messageId) {
      void showMessage(decision.messageId).then((shown) => {
        if (!shown) showError(new Error('That message is no longer there.'));
      });
    } else {
      void showChannel(decision.channelId);
    }
  }
  return (
    <li>
      <button type="button" className="home-decided-row" onClick={open}>
        <span className="home-decided-mark" aria-hidden="true">
          <DecisionIcon size="sm" />
        </span>
        <span className="home-decided-title">{decision.title}</span>
        <span className="home-decided-where">
          {where} · {formatRelative(decision.createdAt)}
        </span>
      </button>
    </li>
  );
}
