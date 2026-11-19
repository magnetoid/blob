/**
 * The channel and section menus as the first load meets them: Base UI's menu is overlay
 * code, so each is fetched on its own (`components/lazyDropdown.tsx`). One pair for the
 * list and the conversation header, so both share the one import.
 */

import { lazyDropdown } from '../../components/lazyDropdown.tsx';

export const ChannelMenu = lazyDropdown(() => import('./ChannelMenu.tsx'));
export const SectionMenu = lazyDropdown(() => import('./SectionMenu.tsx'));
