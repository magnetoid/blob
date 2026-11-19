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
import { memoiseImport, preloadAlso } from '../lib/overlays.ts';

/**
 * What a menu module's default export takes: the button that opens it, which the module
 * hands to its own `DropdownMenuTrigger render={trigger}`, and whether it opens as it is
 * drawn — which it does when somebody pressed the button before the module was here.
 */
export interface DropdownModuleProps {
  trigger: ReactElement;
  defaultOpen?: boolean;
}

/** What `lazyDropdown` reads off the trigger it is given, and adds to the placeholder. */
type TriggerProps = HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> | undefined };

/** Point one ref, of either kind, at a node. */
function assignRef(ref: Ref<HTMLElement> | undefined, node: HTMLElement | null): void {
  if (typeof ref === 'function') ref(node);
  else if (ref) ref.current = node;
}

/**
 * Make a menu that owns its trigger out of a module that is not in the first load.
 *
 * The module is an ordinary shadcn `DropdownMenu` — `<DropdownMenu defaultOpen>`, a
 * `<DropdownMenuTrigger render={trigger} />` and its content — so the menu is Base UI's in
 * full: its trigger, its items, its arrows and typeahead, its dismissal, and focus back on
 * the trigger when it closes. Base UI's menu is overlay code, which must not reach the
 * first load (`lib/overlays.ts`, `scripts/bundle-budget.mjs`), while the shell's triggers
 * are on the page from first paint. So the module is imported lazily — once, shared by
 * every caller (`memoiseImport`), and started beside the overlay chunk (`preloadAlso`) —
 * and until it is here the wrapper draws the trigger itself.
 *
 * That placeholder is the caller's own element, saying what it opens (`aria-haspopup`,
 * `aria-expanded`) and keeping its own click handler. A press on it asks for the module
 * and is held: the module is drawn open the moment it lands — unless the person has gone
 * on while it was on its way, by Tab, by Escape, or by focus landing anywhere outside the
 * trigger, when it is drawn closed and their focus is left where they took it. Focus
 * staying on the trigger is not the test: WebKit does not focus a button that is clicked,
 * so a press can leave focus on <body> the whole time and still be waiting. A module that
 * arrives by the preload is drawn closed, and one already here is drawn in the very render
 * that mounts the wrapper — no Suspense, no placeholder frame. The swap replaces the
 * button's element, so a placeholder that had focus hands it to the real trigger as it
 * mounts; a keyboard user is left where they were.
 *
 * A module that will not load costs the presses that asked for it: the placeholder stays,
 * closed, the failure is logged once however many presses were waiting on that attempt,
 * and the next press tries again (`memoiseImport` forgets a failure). A deploy that replaced the module mid-session is `lib/staleBuild.ts`'s
 * to explain.
 *
 * `preload()` fetches the module and resolves once it is here, rejecting if it could not
 * be fetched; a test awaits it to start with the menu already loaded.
 */
export function lazyDropdown<P extends DropdownModuleProps>(
  load: () => Promise<{ default: ComponentType<P> }>,
): ComponentType<Omit<P, 'defaultOpen'>> & { preload(): Promise<void> } {
  /** The module's component once it has arrived; never unset, as a loaded module stays loaded. */
  let arrived: ComponentType<P> | null = null;
  /** Each mounted wrapper, waiting to hear that it has. */
  const waiting = new Set<() => void>();

  const fetchModule = memoiseImport(() =>
    load().then((module) => {
      arrived = module.default;
      for (const hear of [...waiting]) hear();
    }),
  );
  preloadAlso(fetchModule);

  /** The attempt a press last joined: its failure is reported once, not once per press. */
  let reported: Promise<void> | null = null;
  /** The module, asked for by a press, with a failure said once per attempt. */
  const fetchForPress = (): Promise<void> => {
    const attempt = fetchModule();
    if (attempt !== reported) {
      reported = attempt;
      attempt.catch((error: unknown) => {
        console.error('menu module failed to load', error);
      });
    }
    return attempt;
  };

  const current = () => arrived;

  function LazyDropdown(props: Omit<P, 'defaultOpen'>) {
    const { trigger, ...rest } = props as Omit<P, 'defaultOpen'> & { trigger: ReactElement };
    const own = trigger.props as TriggerProps;
    /** The placeholder's element, while it is on the page. */
    const placeholder = useRef<HTMLElement | null>(null);
    /** Set as the module lands if the placeholder had focus; spent on the real trigger. */
    const refocus = useRef(false);
    const [pressed, setPressed] = useState(false);

    // Subscribed as an external store, so a module already here is read in the first
    // render and one that lands later re-renders. Whether focus was on the placeholder is
    // read as it lands, before React swaps the elements and the browser drops it.
    const subscribe = useCallback((onArrive: () => void) => {
      const hear = () => {
        refocus.current =
          placeholder.current !== null && document.activeElement === placeholder.current;
        onArrive();
      };
      waiting.add(hear);
      return () => {
        waiting.delete(hear);
      };
    }, []);
    const Module = useSyncExternalStore(subscribe, current, current);

    // A press waiting for the module stands only while the person has not gone on. Tab and
    // Escape are ways out, and so is focus landing outside the trigger; listened for on the
    // document, in the capture phase, so nothing that stops them on the way hides them.
    // Nothing is cancelled by a press that leaves focus where it was, <body> included.
    const waitingOnPress = pressed && !Module;
    useEffect(() => {
      if (!waitingOnPress) return undefined;
      // Once the module is here the menu is drawn, and focus moving into it is its own.
      const goneOn = () => {
        if (!arrived) setPressed(false);
      };
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Tab' || event.key === 'Escape') goneOn();
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
    }, [waitingOnPress]);

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
        // Attached before the menu's own content mounts, so a menu opening as it is drawn
        // still moves focus in after this, and takes it home here when it closes.
        if (node && refocus.current) {
          refocus.current = false;
          node.focus({ preventScroll: true });
        }
        assignRef(ownRef, node);
      },
      [ownRef],
    );

    if (Module) {
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
      'aria-haspopup': 'menu',
      'aria-expanded': false,
      onClick: (event: MouseEvent<HTMLElement>) => {
        ownClick?.(event);
        setPressed(true);
        fetchForPress().catch(() => {
          // This press is spent; the placeholder stays, and the next one tries again.
          setPressed(false);
        });
      },
    });
  }

  return Object.assign(LazyDropdown, { preload: () => fetchModule() });
}
