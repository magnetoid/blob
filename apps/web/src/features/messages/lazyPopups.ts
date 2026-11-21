/**
 * The conversation's popups as the first load meets them: Base UI's menus and popovers are
 * overlay code, so each is a module fetched on its own (`components/lazyTrigger.tsx`), and
 * this file is the one place that imports it — one import each, shared by every row.
 *
 * A message row is drawn many times over in a list that is virtualised, and its popups are
 * mostly never pressed, so they mount on the press (`mount: 'press'`): a row scrolled past
 * draws its own button and nothing of Base UI's.
 */

import { lazyTrigger } from '../../components/lazyTrigger.tsx';

export const MessageMenuPopup = lazyTrigger(() => import('./MessageMenuPanel.tsx'), {
  name: 'this menu',
  popup: 'menu',
  mount: 'press',
});

/** The clock beside Send. One per composer, so it mounts as soon as the module is here. */
export const SchedulePopup = lazyTrigger(() => import('./SchedulePanel.tsx'), {
  name: 'scheduling',
  popup: 'dialog',
});
