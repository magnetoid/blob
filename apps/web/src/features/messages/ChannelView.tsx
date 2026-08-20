/** The centre pane: channel header, messages, composer. */

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../lib/store.ts';
import { api } from '../../lib/api.ts';
import { MessageList } from './MessageList.tsx';
import { Composer } from './Composer.tsx';
import { HuddleIcon, MembersIcon, PinIcon } from '../../components/Icon.tsx';
import { TYPING_TTL_MS } from '@blob/shared';

export function ChannelView() {
  const activeChannelId = useStore((s) => s.activeChannelId);
  const channel = useStore((s) => (s.activeChannelId ? s.channels[s.activeChannelId] : undefined));
  const messages = useStore((s) => (s.activeChannelId ? s.messages[s.activeChannelId] : undefined));
  const outbox = useStore((s) => s.outbox);
  const typing = useStore((s) => (s.activeChannelId ? s.typing[s.activeChannelId] : undefined));
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const status = useStore((s) => s.status);
  const unreadMarkers = useStore((s) => s.unreadMarkers);
  const loadOlder = useStore((s) => s.loadOlder);
  const openThread = useStore((s) => s.openThread);
  const channelTitle = useStore((s) => s.channelTitle);

  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  // Typing indicators expire on a timer rather than an event, so re-render slowly.
  useEffect(() => {
    if (!typing || Object.keys(typing).length === 0) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [typing]);

  useEffect(() => {
    if (!activeChannelId) return;
    setMemberCount(null);
    void api.channels
      .members(activeChannelId)
      .then((r) => setMemberCount(r.userIds.length))
      .catch(() => setMemberCount(null));
  }, [activeChannelId]);

  const typingNames = useMemo(() => {
    if (!typing) return [];
    return Object.entries(typing)
      .filter(([userId, at]) => now - at < TYPING_TTL_MS && userId !== currentUser?.id)
      .map(([userId]) => users[userId]?.displayName ?? 'Someone');
  }, [typing, now, users, currentUser]);

  if (!activeChannelId || !channel) {
    return (
      <div className="pane">
        <div className="empty-state">
          <div className="empty-state-mark">#</div>
          <div className="empty-state-title">Pick a conversation</div>
          <div className="empty-state-body">
            Choose a channel or a person on the left to start reading.
          </div>
        </div>
      </div>
    );
  }

  const isDm = channel.kind === 'dm' || channel.kind === 'group_dm';
  const title = channel.name ?? channelTitle(channel);
  const archived = channel.archivedAt !== null;
  const queuedCount = Object.values(outbox).filter((entry) => entry.status === 'queued').length;
  const failedCount = Object.values(outbox).filter((entry) => entry.status === 'failed').length;
  const showDeliveryBanner = status !== 'online' || queuedCount > 0 || failedCount > 0;

  let connectionText: string | null = null;
  if (status === 'connecting') {
    connectionText =
      queuedCount > 0
        ? `Reconnecting… ${queuedCount} ${queuedCount === 1 ? 'message is' : 'messages are'} queued.`
        : 'Reconnecting…';
  } else if (status !== 'online') {
    connectionText =
      queuedCount > 0
        ? `Offline — ${queuedCount} ${queuedCount === 1 ? 'message is' : 'messages are'} queued to send when you reconnect.`
        : 'Offline — new messages will queue until you reconnect.';
  } else if (failedCount > 0) {
    connectionText =
      failedCount === 1
        ? 'One queued message needs attention before it can be sent.'
        : `${failedCount} queued messages need attention before they can be sent.`;
  } else if (queuedCount > 0) {
    connectionText =
      queuedCount === 1 ? 'Sending one queued message…' : `Sending ${queuedCount} queued messages…`;
  }

  return (
    <div className="pane">
      <header className="pane-header">
        <div style={{ minWidth: 0 }}>
          <div className="pane-heading">
            {!isDm && (
              <span className="pane-prefix" aria-hidden="true">
                #
              </span>
            )}
            <h1 className="pane-title">{title}</h1>
          </div>
          <div className="pane-sub">
            {channel.topic || (isDm ? 'Direct message' : 'No topic set')}
          </div>
        </div>

        <div className="pane-spacer" />

        <button className="btn" disabled title="Huddles arrive in a later release">
          <HuddleIcon size={15} />
          Huddle
        </button>
        <button className="btn btn-ghost" title="Members">
          <MembersIcon size={15} />
          {memberCount ?? '–'}
        </button>
      </header>

      {showDeliveryBanner && connectionText && (
        <div className="connection-banner">
          {connectionText}
        </div>
      )}

      {archived && (
        <div className="pinned-bar">
          <PinIcon size={13} />
          <span className="pinned-label">Archived</span>
          <span>This channel is read-only. Its history stays searchable.</span>
        </div>
      )}

      <MessageList
        messages={messages?.items ?? []}
        hasMore={messages?.hasMore ?? false}
        loading={messages?.loading ?? false}
        onLoadOlder={() => void loadOlder(activeChannelId)}
        onOpenThread={(rootId) => void openThread(rootId)}
        unreadAfterId={unreadMarkers[activeChannelId] ?? null}
        emptyState={
          <div className="empty-state">
            <div className="empty-state-mark">{isDm ? '@' : '#'}</div>
            <div className="empty-state-title">
              This is the start of {isDm ? title : `#${title}`}
            </div>
            <div className="empty-state-body">
              {isDm
                ? 'Say hello. Nobody else can see this conversation.'
                : 'No messages yet. Set a topic so people know what belongs here, or invite the folks who should be in the loop.'}
            </div>
          </div>
        }
      />

      <div className="typing-line" aria-live="polite">
        {typingNames.length > 0 && (
          <span className="typing-dots">
            <i />
            <i />
            <i />
            <span className="typing-text">
              {typingNames.length === 1
                ? `${typingNames[0]} is typing…`
                : typingNames.length === 2
                  ? `${typingNames[0]} and ${typingNames[1]} are typing…`
                  : 'Several people are typing…'}
            </span>
          </span>
        )}
      </div>

      {!archived && (
        <Composer
          channelId={activeChannelId}
          placeholder={isDm ? `Message ${title}` : `Message #${title}`}
        />
      )}
    </div>
  );
}
