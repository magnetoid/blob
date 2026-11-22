// @vitest-environment happy-dom
/**
 * A menu or popover that owns its trigger, from a module that is not in the first load.
 *
 * `lazyTrigger` is `lazyDropdown` grown to the conversation's needs, and every promise of
 * that one is still its own (`lazyDropdown.test.tsx`, which goes through it). What is new
 * is pinned here. The placeholder says which kind of popup it opens, a popover's as well as
 * a menu's. A message row in a virtualised list mounts on every scroll, so `mount: 'press'`
 * draws nothing of Base UI's until somebody presses it, even with the module long here.
 * And a press whose module will not load says so — reload, since WebKit keeps a failed
 * import for the life of the page — rather than doing nothing.
 *
 * The modules here are real ones, built from shadcn's Popover, imported while the file is
 * collected; only the moment an import resolves is the test's to choose.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.tsx';
import { lazyTrigger, type TriggerModuleProps } from './lazyTrigger.tsx';
import { preloadAlso } from '../lib/overlays.ts';
import { useToasts } from '../lib/toasts.ts';

// The registration is the case's to look at; nothing here runs the app's preload.
vi.mock('../lib/overlays.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/overlays.ts')>()),
  preloadAlso: vi.fn(),
}));

/** The props each drawing of the module was given, in order. */
const drawn: TriggerModuleProps[] = [];

/** What a later task writes: shadcn's popover, with its own trigger. */
function ProfileCard(props: TriggerModuleProps) {
  drawn.push(props);
  return (
    <Popover defaultOpen={props.defaultOpen}>
      <PopoverTrigger render={props.trigger} />
      <PopoverContent aria-label="Ada Lovelace">Ada Lovelace</PopoverContent>
    </Popover>
  );
}

/** The same card, opening without moving focus: where focus is after the swap is the swap's. */
function QuietCard(props: TriggerModuleProps) {
  return (
    <Popover defaultOpen={props.defaultOpen}>
      <PopoverTrigger render={props.trigger} />
      <PopoverContent aria-label="Ada Lovelace" initialFocus={false}>
        Ada Lovelace
      </PopoverContent>
    </Popover>
  );
}

type TriggerModule = { default: ComponentType<TriggerModuleProps> };

/** One fetch, still on the wire: the case lands it or drops it. */
type Attempt<T> = { resolve: (value: T) => void; reject: (reason: unknown) => void };

/** An import the test holds: each call is one fetch, landed or dropped by the case. */
function heldImport(Module: ComponentType<TriggerModuleProps> = ProfileCard) {
  const attempts: Attempt<TriggerModule>[] = [];
  const load = vi.fn(
    () =>
      new Promise<TriggerModule>((resolve, reject) => {
        attempts.push({ resolve, reject });
      }),
  );
  return {
    load,
    release: () => attempts.at(-1)!.resolve({ default: Module }),
    fail: () =>
      attempts.at(-1)!.reject(new TypeError('Failed to fetch dynamically imported module')),
  };
}

const ada = () => screen.getByRole('button', { name: 'Ada' });
const grace = () => screen.getByRole('button', { name: 'Grace' });

beforeEach(() => {
  vi.mocked(preloadAlso).mockReset();
  useToasts.setState({ toasts: [] });
  drawn.length = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('lazyTrigger', () => {
  it('marks the placeholder with the kind of popup it opens', () => {
    const { load } = heldImport();
    const Card = lazyTrigger(load, { name: 'this profile', popup: 'dialog' });

    render(<Card trigger={<button type="button">Ada</button>} />);

    expect(ada().getAttribute('aria-haspopup')).toBe('dialog');
    expect(ada().getAttribute('aria-expanded')).toBe('false');
  });

  it('with mount press, draws the placeholder until pressed even once the module is here', async () => {
    const { load, release } = heldImport();
    const Card = lazyTrigger(load, { name: 'this profile', popup: 'dialog', mount: 'press' });
    const preloaded = Card.preload();
    release();
    await preloaded;

    render(<Card trigger={<button type="button">Ada</button>} />);

    // A row scrolled past costs no Base UI root: the module is here and is not drawn.
    expect(drawn).toHaveLength(0);
    expect(ada().getAttribute('data-slot')).toBeNull();
    expect(ada().getAttribute('aria-haspopup')).toBe('dialog');

    fireEvent.click(ada());

    // Drawn by the press, and open because it was a press.
    expect(drawn.at(-1)?.defaultOpen).toBe(true);
    expect(ada().getAttribute('data-slot')).toBe('popover-trigger');
    expect(await screen.findByRole('dialog', { name: 'Ada Lovelace' })).toBeTruthy();
  });

  it('with mount press, hands focus to the real trigger when a focused placeholder is pressed', async () => {
    const { load, release } = heldImport(QuietCard);
    const Card = lazyTrigger(load, { name: 'this profile', popup: 'dialog', mount: 'press' });
    const preloaded = Card.preload();
    release();
    await preloaded;
    render(<Card trigger={<button type="button">Ada</button>} />);
    const placeholder = ada();

    // From the keyboard: the press is the swap, and focus goes with it rather than to <body>.
    placeholder.focus();
    fireEvent.click(placeholder);

    expect(await screen.findByRole('dialog', { name: 'Ada Lovelace' })).toBeTruthy();
    expect(ada()).not.toBe(placeholder);
    expect(document.activeElement).toBe(ada());
  });

  it('opens only the later of two presses waiting on the module, where a click leaves focus be', async () => {
    // WebKit, and Firefox on macOS, do not focus a button that is clicked, so the second
    // press does not move focus off the first and cancel it that way. The person has gone
    // on from the first all the same, and one popup opens: the one pressed last.
    const { load, release } = heldImport(QuietCard);
    const Card = lazyTrigger(load, { name: 'this profile', popup: 'dialog' });
    render(
      <>
        <Card trigger={<button type="button">Ada</button>} />
        <Card trigger={<button type="button">Grace</button>} />
      </>,
    );
    fireEvent.click(ada());
    fireEvent.click(grace());
    expect(document.activeElement).toBe(document.body);

    await act(async () => release());

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(ada().getAttribute('aria-expanded')).toBe('false');
    expect(grace().getAttribute('aria-expanded')).toBe('true');
  });

  it('says so when a pressed module will not load, and stays closed', async () => {
    // The log is the one console.error expected here; any other case's would be a warning.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { load, fail } = heldImport();
    const Menu = lazyTrigger(load, { name: 'this menu', popup: 'menu' });

    render(<Menu trigger={<button type="button">Ada</button>} />);
    const placeholder = ada();
    fireEvent.click(placeholder);
    await act(async () => fail());

    expect(consoleError).toHaveBeenCalledWith(
      'module for this menu failed to load',
      expect.any(TypeError),
    );
    expect(useToasts.getState().toasts).toEqual([
      expect.objectContaining({
        kind: 'error',
        text: 'Couldn’t open this menu. Reload the page to try again.',
      }),
    ]);
    expect(ada()).toBe(placeholder);
    expect(placeholder.getAttribute('aria-expanded')).toBe('false');
  });
});
