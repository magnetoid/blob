import {
  cloneElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type HTMLAttributes,
  type JSX,
  type MouseEvent,
  type ReactElement,
  type Ref,
} from 'react';
import { lazyModule } from '../lib/lazyModule.ts';
import { useEscape } from '../lib/useEscape.ts';

/**
 * What a trigger module's default export takes: the button that opens it, which the module
 * hands to its own trigger (`DropdownMenuTrigger render={trigger}`, `PopoverTrigger
 * render={trigger}`), and whether it opens as it is drawn — which it does when somebody
 * pressed the button before the module was drawn.
 */
export interface TriggerModuleProps {
  trigger: ReactElement;
  defaultOpen?: boolean;
}

/** What `lazyTrigger` reads off the trigger it is given, and adds to the placeholder. */
type TriggerProps = HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> | undefined };

/** Point one ref, of either kind, at a node. */
function assignRef(ref: Ref<HTMLElement> | undefined, node: HTMLElement | null): void {
  if (typeof ref === 'function') ref(node);
  else if (ref) ref.current = node;
}

/** Whether focus is on this node: read before React swaps it out and the browser drops it. */
function hasFocus(node: HTMLElement | null): boolean {
  return node !== null && document.activeElement === node;
}

/**
 * Make a menu or popover that owns its trigger out of a module that is not in the first
 * load.
 *
 * The module is an ordinary shadcn `DropdownMenu` or `Popover` — `defaultOpen`, a trigger
 * with `render={trigger}` and its content — so the popup is Base UI's in full: its trigger,
 * its items, its arrows and typeahead, its dismissal, and focus back on the trigger when it
 * closes. Base UI's popups are overlay code, which must not reach the first load
 * (`lib/overlays.ts`, `scripts/bundle-budget.mjs`), while their triggers are on the page
 * from first paint. So the module is imported lazily — once, shared by every caller, and
 * started beside the overlay chunk (`lib/lazyModule.ts`) — and until it is here the wrapper
 * draws the trigger itself.
 *
 * That placeholder is the caller's own element, saying what it opens (`aria-haspopup`, from
 * `popup`, and `aria-expanded`) and keeping its own click handler. A press on it asks for
 * the module and is held: the module is drawn open the moment it lands — unless the person
 * has gone on while it was on its way, by Tab, by Escape, or by focus landing anywhere
 * outside the trigger, when it is drawn closed and their focus is left where they took it.
 * The Escape is the popup's even before there is one: a waiting press holds the popup's
 * place on the Escape stack (`lib/useEscape.ts`), as a menu does once it is drawn
 * (`lib/useMenuEscapeLayer.ts`), so a panel open behind it does not hear that key. Focus
 * staying on the trigger is not the test: WebKit does not focus a button that is clicked,
 * so a press can leave focus on <body> the whole time and still be waiting. A module that
 * arrives by the preload is drawn closed, and one already here is drawn in the very render
 * that mounts the wrapper — no Suspense, no placeholder frame. The swap replaces the
 * button's element, so a placeholder that had focus hands it to the real trigger as it
 * mounts; a keyboard user is left where they were.
 *
 * `mount: 'press'` is for a trigger drawn many times over and mostly never pressed — a
 * message row's, in a list that is virtualised, so rows mount on every scroll. There the
 * placeholder stays until the first press on it even when the module is long here, so a row
 * scrolled past costs no Base UI root; the press draws the module, open, and from then on it
 * stays drawn for that wrapper's life. `mount: 'arrival'`, the default, draws it as soon as
 * it is here, as the shell's menus do.
 *
 * A module that will not load costs the presses that asked for it: the placeholder stays,
 * closed, the person is told to reload once however many presses were waiting on that
 * attempt (`lazyModule`'s `loadForPerson`, with `name`: "Couldn’t open this menu…"), and
 * the next press tries again.
 *
 * `preload()` fetches the module and resolves once it is here, rejecting if it could not
 * be fetched; a test awaits it to start with the module already loaded.
 */
export function lazyTrigger<P extends TriggerModuleProps>(
  load: () => Promise<{ default: ComponentType<P> }>,
  options: { name: string; popup: 'menu' | 'dialog'; mount?: 'arrival' | 'press' },
): ComponentType<Omit<P, 'defaultOpen'>> & { preload(): Promise<void> } {
  const { name, popup, mount = 'arrival' } = options;
  const source = lazyModule(load, name);
  /** The module's component once it has arrived; never unset, as a loaded module stays loaded. */
  const current = () => source.current()?.default ?? null;

  function LazyTrigger(props: Omit<P, 'defaultOpen'>) {
    const { trigger, ...rest } = props as Omit<P, 'defaultOpen'> & { trigger: ReactElement };
    const own = trigger.props as TriggerProps;
    /** The placeholder's element, while it is on the page. */
    const placeholder = useRef<HTMLElement | null>(null);
    /** Set as the placeholder is swapped out if it had focus; spent on the real trigger. */
    const refocus = useRef(false);
    const [pressed, setPressed] = useState(false);
    /** Whether the module may be drawn once it is here: at once, or from the first press. */
    const [engaged, setEngaged] = useState(mount === 'arrival');

    // Subscribed as an external store, so a module already here is read in the first
    // render and one that lands later re-renders. Whether focus was on the placeholder is
    // read as it lands, before React swaps the elements.
    const subscribe = useCallback(
      (onArrive: () => void) =>
        source.subscribe(() => {
          refocus.current = hasFocus(placeholder.current);
          onArrive();
        }),
      [],
    );
    const Module = useSyncExternalStore(subscribe, current, current);

    // A press waiting for the module stands only while the person has not gone on. Tab and
    // Escape are ways out, and so is focus landing outside the trigger. Escape through the
    // shared stack, where the press is the innermost thing open; Tab and focus on the
    // document, in the capture phase, so nothing that stops them on the way hides them.
    // Nothing is cancelled by a press that leaves focus where it was, <body> included.
    const waitingOnPress = pressed && !Module;
    // Once the module is here the popup is drawn, and focus moving into it is its own.
    const goneOn = useCallback(() => {
      if (!current()) setPressed(false);
    }, []);
    useEscape(goneOn, waitingOnPress);
    useEffect(() => {
      if (!waitingOnPress) return undefined;
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Tab') goneOn();
      };
      const onFocus = (event: FocusEvent) => {
        const target = event.target;
        if (!(target instanceof Node) || !placeholder.current?.contains(target)) goneOn();
      };
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('focusin', onFocus, true);
      return () => {
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('focusin', onFocus, true);
      };
    }, [waitingOnPress, goneOn]);

    const ownRef = own.ref;
    const placeholderRef = useCallback(
      (node: HTMLElement | null) => {
        placeholder.current = node;
        assignRef(ownRef, node);
      },
      [ownRef],
    );
    const triggerRef = useCallback(
      (node: HTMLElement | null) => {
        // Attached before the popup's own content mounts, so a popup opening as it is
        // drawn still moves focus in after this, and takes it home here when it closes.
        if (node && refocus.current) {
          refocus.current = false;
          node.focus({ preventScroll: true });
        }
        assignRef(ownRef, node);
      },
      [ownRef],
    );

    if (Module && engaged) {
      const moduleProps = {
        ...rest,
        trigger: cloneElement(trigger as ReactElement<TriggerProps>, { ref: triggerRef }),
        defaultOpen: pressed,
      } as unknown as P & JSX.IntrinsicAttributes;
      return <Module {...moduleProps} />;
    }

    const ownClick = own.onClick;
    return cloneElement(trigger as ReactElement<TriggerProps>, {
      ref: placeholderRef,
      'aria-haspopup': popup,
      'aria-expanded': false,
      onClick: (event: MouseEvent<HTMLElement>) => {
        ownClick?.(event);
        // With the module already here this press is the swap, so focus is read now;
        // otherwise the module's arrival reads it again, as it lands.
        refocus.current = hasFocus(placeholder.current);
        setPressed(true);
        setEngaged(true);
        source.loadForPerson().catch(() => {
          // This press is spent; the placeholder stays, and the next one tries again.
          setPressed(false);
        });
      },
    });
  }

  return Object.assign(LazyTrigger, {
    preload: () => source.load().then(() => undefined),
  });
}
