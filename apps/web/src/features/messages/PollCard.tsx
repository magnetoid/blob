/** A poll under its question (ADR 0041): choose, see how it stands, and — for whoever asked
 * it, or an admin — close it.
 *
 * Who chose what is shown the way reactions show it, in a tooltip of names; an anonymous
 * poll shows counts only, and your own choice comes from the one request that is yours
 * alone (`GET /api/messages/{id}/poll`). A vote is applied from the server's answer at once,
 * and the room hears it as `message.updated`.
 */

import { useState } from 'react';
import type { Message, Poll, PollOption } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useFetch } from '../../lib/useFetch.ts';
import { useStore } from '../../lib/store.ts';
import { showError } from '../../lib/toasts.ts';

function chosenBy(poll: Poll, me: string | null): string[] {
  if (me === null) return [];
  return poll.options.filter((option) => option.voterIds?.includes(me)).map((option) => option.id);
}

/** The bar behind an option, as wide as its share: set through the element, which keeps
 * the size out of an inline style (`sourceRatchets`). */
function shareOf(share: number) {
  return (element: HTMLSpanElement | null) => {
    element?.style.setProperty('--share', `${share}%`);
  };
}

export function PollCard({ message, tabIndex }: { message: Message; tabIndex?: number }) {
  const poll = message.poll;
  const me = useStore((s) => s.currentUser?.id ?? null);
  const isAdmin = useStore(
    (s) => s.currentUser?.role === 'admin' || s.currentUser?.role === 'owner',
  );
  const users = useStore((s) => s.users);
  const anonymous = poll?.anonymous ?? false;
  const { data: fetchedMine } = useFetch(
    async () => (anonymous ? (await api.messages.myVote(message.id)).mine : null),
    [message.id, anonymous],
  );
  // What this person chose, once they choose here: an anonymous poll says it to them only.
  const [answered, setAnswered] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  if (!poll) return null;

  const mine = anonymous ? (answered ?? fetchedMine ?? []) : chosenBy(poll, me);
  const closed = poll.closedAt !== null;
  const total = poll.options.reduce((sum, option) => sum + option.count, 0);

  function names(option: PollOption): string | undefined {
    if (!option.voterIds || option.voterIds.length === 0) return undefined;
    return option.voterIds.map((id) => users[id]?.displayName ?? 'Someone').join(', ');
  }

  async function choose(option: PollOption) {
    if (busy || closed) return;
    const picked = mine.includes(option.id);
    const next = poll!.multiple
      ? picked
        ? mine.filter((id) => id !== option.id)
        : [...mine, option.id]
      : picked
        ? []
        : [option.id];
    setBusy(true);
    try {
      const answer = await api.messages.vote(message.id, next);
      setAnswered(answer.mine);
      useStore.getState().applyEvent({ t: 'message.updated', message: answer.message });
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    try {
      const answer = await api.messages.closePoll(message.id);
      useStore.getState().applyEvent({ t: 'message.updated', message: answer.message });
    } catch (err) {
      showError(err);
    }
  }

  const people = poll.voters === 1 ? '1 person voted' : `${poll.voters} people voted`;
  return (
    <div className="poll" data-closed={closed ? 'true' : undefined}>
      <ul className="poll-options">
        {poll.options.map((option) => {
          const picked = mine.includes(option.id);
          const share = total > 0 ? Math.round((option.count / total) * 100) : 0;
          return (
            <li key={option.id}>
              <button
                type="button"
                className="poll-option"
                aria-pressed={picked}
                disabled={closed || busy}
                tabIndex={tabIndex}
                title={names(option)}
                onClick={() => void choose(option)}
              >
                <span ref={shareOf(share)} className="poll-option-bar" aria-hidden="true" />
                <span
                  className="poll-option-mark"
                  data-shape={poll.multiple ? 'box' : 'dot'}
                  aria-hidden="true"
                />
                <span className="poll-option-text">{option.text}</span>
                <span className="poll-option-count">
                  {option.count}
                  <span className="sr-only">{option.count === 1 ? ' vote' : ' votes'}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="poll-meta">
        <span>{people}</span>
        {poll.multiple && <span>Choose any</span>}
        {poll.anonymous && <span>Anonymous</span>}
        {closed && <span>Closed</span>}
        {!closed && (me === message.authorId || isAdmin) && (
          <button type="button" className="btn btn-ghost poll-close" tabIndex={tabIndex} onClick={() => void close()}>
            Close poll
          </button>
        )}
      </div>
    </div>
  );
}
