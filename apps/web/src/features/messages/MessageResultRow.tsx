/** One result row — a message shown outside its own conversation.
 *
 * Search, Threads and Later render the same shape: avatar, author, where the message
 * lives, when it moved, the body as markdown. app.css styles it by these exact class
 * names, so the per-list extras arrive as slots rather than as copies of the row.
 */

import type { ReactNode } from 'react';
import type { ChannelWithState, Message } from '@blob/shared';
import { useStore } from '../../lib/store.ts';
import { renderMarkdown } from '../../lib/markdown.tsx';
import { Avatar } from '../../components/Avatar.tsx';
import { formatRelative } from './messageFormatting.ts';
import { useMentionIndex } from './mentionIndex.ts';

interface Props {
  message: Message;
  onOpen: () => void;
  /** The moment shown after the channel name; null leaves the time off entirely. */
  timestamp: string | null;
  /** Extra line under the body, inside the clickable area — e.g. a reply count. */
  footer?: ReactNode;
  /** Trailing control that must stay outside the clickable area — e.g. an unsave button. */
  action?: ReactNode;
  /** Leftover search words to mark in the body. */
  highlight?: string;
}

/** Where a message was said, in the words its row needs. A direct message's title is the
 *  other person, which beside their own name read "Devin Cole · Devin Cole": theirs says
 *  it is a direct message, and yours says whom it went to. */
function placeOf(
  channel: ChannelWithState | undefined,
  title: (channel: ChannelWithState) => string,
  authorId: string | null,
  me: string | null,
): string {
  if (!channel) return 'A conversation';
  if (channel.name) return `#${channel.name}`;
  if (channel.kind === 'dm') {
    return authorId !== null && authorId === me ? `To ${title(channel)}` : 'Direct message';
  }
  return title(channel);
}

export function MessageResultRow({ message, onOpen, timestamp, footer, action, highlight }: Props) {
  const users = useStore((s) => s.users);
  const channels = useStore((s) => s.channels);
  const channelTitle = useStore((s) => s.channelTitle);
  const customEmoji = useStore((s) => s.customEmoji);
  const currentUserId = useStore((s) => s.currentUser?.id ?? null);
  const knownNames = useMentionIndex();

  const author = message.authorId ? users[message.authorId] : undefined;
  const channel = channels[message.channelId];

  const content = (
    <>
      <div className="search-result-head">
        <span className="search-result-author">{author?.displayName ?? 'Someone'}</span>
        <span className="search-result-meta">
          {placeOf(channel, channelTitle, message.authorId ?? null, currentUserId)}
          {timestamp && ` · ${formatRelative(timestamp)}`}
        </span>
      </div>
      <div className="search-result-text">
        {renderMarkdown(message.body, {
          knownNames,
          currentUserId,
          customEmoji,
          highlight,
          // An agent's reply in its own dialect, as in the conversation — but no fold:
          // this row already clips the body to a few lines.
          agent: author?.kind === 'bot',
          // The row is a button; a code block's Copy inside it would be a button in one.
          copyableCode: false,
        })}
      </div>
      {footer}
    </>
  );

  // A trailing control cannot nest inside a <button>, so a row that has one is a <div>
  // whose clickable part is an inner button — the structure app.css styles as saved-row.
  if (action) {
    return (
      <div className="search-result saved-row">
        <Avatar user={author} size="lg" />
        <button className="saved-body" type="button" onClick={onOpen}>
          {content}
        </button>
        {action}
      </div>
    );
  }

  return (
    <button className="search-result" type="button" onClick={onOpen}>
      <Avatar user={author} size="lg" />
      <div className="grow min-0">{content}</div>
    </button>
  );
}
