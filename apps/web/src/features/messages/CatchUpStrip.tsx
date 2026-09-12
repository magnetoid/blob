/** "While you were away" — the offer to summarise, at the top of a channel you left.
 *
 * The design draws this strip holding a written recap: *Scout finished the cohort
 * analysis, Marko flagged a pricing question for you, two decisions were made.* This one
 * does not, and that is deliberate. A recap is a model call over everything unread;
 * firing one on every channel open with a backlog would spend a key on channels nobody
 * asked about and make opening a channel wait on a provider. So the strip carries what
 * is already known — that there is something here, and whether any of it names you — and
 * the summary is one click behind it, which is the existing `CatchUpPanel`.
 *
 * It also has to stay honest on a server with no model at all, which is what both
 * production instances run: `services/agentic.py` falls back to a keyword scan there.
 * Promising a recap in the strip and delivering a heuristic one behind it would make the
 * strip the lie. Naming the offer rather than its result cannot be wrong either way.
 *
 * Not the same thing as the unread jump bar inside the list: that one moves you to the
 * first thing you have not read, this one offers to save you reading it.
 */

import { useStore } from '../../lib/store.ts';
import { SparkIcon } from '../../components/Icon.tsx';

export function CatchUpStrip({
  hasUnread,
  mentionCount,
  onDismiss,
}: {
  hasUnread: boolean;
  mentionCount: number;
  onDismiss: () => void;
}) {
  if (!hasUnread) return null;

  return (
    <div className="catchup-strip">
      <span className="catchup-strip-mark" aria-hidden="true">
        <SparkIcon size="sm" />
      </span>
      <p className="catchup-strip-text">
        <b>While you were away</b> —{' '}
        {mentionCount > 0
          ? `there are new messages here, and ${mentionCount} of them ${
              mentionCount === 1 ? 'mentions' : 'mention'
            } you.`
          : 'there are new messages here.'}
      </p>
      <button
        type="button"
        className="catchup-strip-action"
        onClick={() => useStore.setState({ catchupScope: 'channel' })}
      >
        Read catch-up →
      </button>
      <button
        type="button"
        className="catchup-strip-dismiss"
        aria-label="Dismiss catch-up"
        onClick={onDismiss}
      >
        ✕
      </button>
    </div>
  );
}
