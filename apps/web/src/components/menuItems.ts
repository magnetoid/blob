/**
 * Every menu item that can take focus, in DOM order: what a menu's arrows walk
 * (`components/Menu.tsx`) and where focus goes as a menu opens (`overlays/MenuImpl.tsx`).
 * One selector for both, so the item focus starts on is always one the arrows can leave.
 * Disabled items cannot take focus, so offering them would strand the roving focus on the
 * way past.
 */
export const MENU_ITEM =
  '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)';
