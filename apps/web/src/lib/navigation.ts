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

import { navigate } from './router.ts';
import { useStore } from './store.ts';

/** Open a channel and show it — what a click on a channel, person or result means. */
export async function showChannel(channelId: string): Promise<void> {
  await useStore.getState().openChannel(channelId);
  navigate('/');
}
