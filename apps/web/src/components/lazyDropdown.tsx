import type { ComponentType } from 'react';
import { lazyTrigger, type LazyTriggerComponent, type TriggerModuleProps } from './lazyTrigger.tsx';

/**
 * What a menu module's default export takes: the button that opens it, which the module
 * hands to its own `DropdownMenuTrigger render={trigger}`, and whether it opens as it is
 * drawn — which it does when somebody pressed the button before the module was here.
 */
export type DropdownModuleProps = TriggerModuleProps;

/**
 * Make a menu that owns its trigger out of a module that is not in the first load.
 *
 * The module is an ordinary shadcn `DropdownMenu` — `<DropdownMenu defaultOpen>`, a
 * `<DropdownMenuTrigger render={trigger} />` and its content. Everything about the wait is
 * `lazyTrigger`'s (`components/lazyTrigger.tsx`): the placeholder saying it opens a menu,
 * the press held until the module lands and the ways out of it, the focus handed to the
 * real trigger, and a failed load told once as "Couldn’t open this menu…". The shell's
 * menus are drawn as soon as their module is here.
 */
export function lazyDropdown<P extends DropdownModuleProps>(
  load: () => Promise<{ default: ComponentType<P> }>,
): LazyTriggerComponent<P> {
  return lazyTrigger(load, { name: 'this menu', popup: 'menu' });
}
