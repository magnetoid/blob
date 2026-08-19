/** The right panel's thread view: root message plus its replies. */

import { useStore } from '../../lib/store.ts';
import { MessageList } from './MessageList.tsx';
import { Composer } from './Composer.tsx';
import { CloseIcon } from '../../components/Icon.tsx';

export function ThreadPanel({ rootId }: { rootId: string }) {
  const thread = useStore((s) => s.threads[rootId]);
  const channels = useStore((s) => s.channels);
  const openThread = useStore((s) => s.openThread);
  const channelTitle = useStore((s) => s.channelTitle);

  const root = thread?.[0];
  const channel = root ? channels[root.channelId] : undefined;
  const replyCount = Math.max((thread?.length ?? 1) - 1, 0);

  return (
    <aside className="panel" aria-label="Thread">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Thread</h2>
          <div className="panel-sub">
            {channel ? (channel.name ? `#${channel.name}` : channelTitle(channel)) : ''}
            {replyCount > 0 && ` · ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
          </div>
        </div>
        <button className="icon-btn" onClick={() => void openThread(null)} title="Close thread">
          <CloseIcon size={15} />
        </button>
      </div>

      <MessageList
        messages={thread ?? []}
        hasMore={false}
        loading={!thread}
        onLoadOlder={() => {}}
        onOpenThread={() => {}}
        unreadAfterId={null}
        inThread
      />

      {root && (
        <Composer
          channelId={root.channelId}
          threadRootId={rootId}
          placeholder="Reply in thread"
          autoFocus
        />
      )}
    </aside>
  );
}
