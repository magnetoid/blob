/** Going to a conversation, as opposed to loading one.
 *
 * `store.openChannel` does half of what a click on a channel means: it makes that
 * channel the active one and fetches its history. It does not change the route, because
 * it is also what the shell calls on arrival to pick a channel to start on — and doing
 * it there would throw away a deep link to /search or /workspace.
 *
 * So every *user-initiated* open had to navigate as well, and none of them did. Picking
 * a channel in ⌘K while reading search results, or clicking a search result at all,
 * loaded the channel behind a view that stayed exactly where it was: the click appeared
 * to do nothing. The Threads view would have been a fourth place to get stuck, which is
 * what turned three scattered omissions into one named thing.
 */

import { api } from './api.ts';
import { navigate, pathForChannel } from './router.ts';
import { useStore } from './store.ts';

/** How long a jumped-to message stays highlighted. Matches the CSS animation. */
const FLASH_MS = 1600;

/** Open a channel and show it — what a click on a channel, person or result means. */
export async function showChannel(channelId: string): Promise<void> {
  await useStore.getState().openChannel(channelId);
  navigate(pathForChannel(channelId));
}

/** Open a thread beside its conversation, loading the conversation first if needed. */
export async function showThread(channelId: string, rootId: string): Promise<void> {
  const store = useStore.getState();
  if (store.activeChannelId !== channelId) await store.openChannel(channelId);
  await store.openThread(rootId);
  navigate(pathForChannel(channelId, rootId));
}

/** Close the thread panel. A push, not a replace: Back reopens the thread. */
export function closeThread(): void {
  const store = useStore.getState();
  void store.openThread(null);
  if (store.activeChannelId) navigate(pathForChannel(store.activeChannelId));
}

/**
 * Bring a message into view and mark it, if it is on screen.
 *
 * An attribute rather than an `id`, because the same message renders in the list and in
 * a thread at once and duplicate ids would make the first one win at random.
 *
 * Returns whether it found anything, so a caller that has just loaded a page around the
 * message can tell "not rendered yet" from "not here at all" instead of guessing.
 */
export function scrollToMessage(messageId: string): boolean {
  const node = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!node) return false;
  node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  flashMessage(messageId);
  return true;
}

/**
 * Mark a message as the one you were sent to, if it is on screen.
 *
 * Split from `scrollToMessage` because the virtualized list scrolls by *index* and then
 * needs the highlight separately — by the time a row exists to mark, the scrolling has
 * already been done by something that never had an element to work with.
 */
export function flashMessage(messageId: string): void {
  const node = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!node) return;
  node.classList.add('message-flash');
  setTimeout(() => node.classList.remove('message-flash'), FLASH_MS);
}

/**
 * Follow a permalink: /m/<messageId>.
 *
 * Three steps, and the order is forced. The message has to be fetched first because the
 * link carries nothing else — not the channel, and not the thread. Then the channel is
 * loaded *around* the target rather than at its newest page, since a link worth sending
 * is usually to something old. Only then can the thread be opened, because the panel
 * renders beside the conversation.
 *
 * A thread reply is never in channel history — `history` filters `thread_root_id IS
 * NULL` in all three of its modes — so for a reply the channel is centred on the thread
 * *root* and the reply itself is found in the panel.
 *
 * The jump itself is left to whichever list holds the message. It cannot be done from
 * here: the channel list is virtualized, so a target that is not already on screen has
 * no element to scroll to and never will until something scrolls to its *index* first.
 * That something is `MessageList`, which owns the virtualizer, so the id is handed to
 * the store and the list picks it up on the render that first contains it.
 *
 * Before this, `showMessage` looked the element up on the next two frames and gave up.
 * The history was fetched correctly and centred on the message every time — the search
 * result, the permalink and the saved item all landed at the bottom of the right channel
 * with the message they named twenty rows out of sight.
 */
export async function showMessage(messageId: string): Promise<boolean> {
  const store = useStore.getState();
  const { message } = await api.messages.get(messageId);

  await store.openChannel(message.channelId, message.threadRootId ?? message.id);
  if (message.threadRootId) await store.openThread(message.threadRootId);
  navigate(pathForChannel(message.channelId, message.threadRootId ?? undefined));
  store.requestScrollToMessage(messageId);
  return true;
}

/** The address of one message, for pasting somewhere else. */
export function permalinkFor(messageId: string): string {
  return `${window.location.origin}/m/${messageId}`;
}
