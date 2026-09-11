/** Typing is per conversation, not per channel.

A thread and its parent channel used to share one map keyed only by channelId, so
typing in a thread lit the channel composer too.
*/

export function typingKey(channelId: string, threadRootId?: string | null): string {
  return threadRootId ? `${channelId}:${threadRootId}` : channelId;
}
