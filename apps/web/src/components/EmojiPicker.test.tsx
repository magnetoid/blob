// @vitest-environment happy-dom
/**
 * The emoji picker: its search, its grid, its keys and its skin tones (`EmojiPicker.tsx`),
 * and the popover it opens in (`EmojiPopover.tsx`), which is shadcn's — Base UI's — and a
 * module of its own, drawn only once its trigger is pressed (`features/messages/lazyPopups.ts`).
 *
 * Skin tones live on the picker, not on the catalog. Hands take a Fitzpatrick modifier;
 * party poppers do not. The bar remembers the last tone so the next 👍 is the same colour
 * as the last, and a custom emoji is never rewritten — it is an image, not a character.
 * The workspace's own emoji come first: they are the vocabulary that is specific to the
 * people using this deployment.
 *
 * Closing is the popover's: a pick, Escape, a click outside, and focus going back to the
 * trigger are all Base UI's. While it is open it holds its place on the Escape stack
 * (`lib/useMenuEscapeLayer.ts`), so one Escape closes the picker and nothing behind it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useStore } from '../lib/store.ts';
import { useEscape } from '../lib/useEscape.ts';
import { EmojiPicker } from './EmojiPicker.tsx';
import { lazyTrigger } from './lazyTrigger.tsx';
import type { EmojiPopoverProps } from './EmojiPopover.tsx';
import { EmojiPopup } from '../features/messages/lazyPopups.ts';

// Here before the first test, as it normally is in the app by the time a trigger is pressed.
await EmojiPopup.preload();

afterEach(cleanup);

beforeEach(() => {
  useStore.setState({ customEmoji: [] });
  window.localStorage?.clear?.();
});

/** The emoji in the grid, which are named by their shortcode; the tones are not. */
const cells = () =>
  screen.getAllByRole('button').filter((b) => b.getAttribute('aria-label')?.startsWith(':'));

function search(query: string) {
  const field = screen.getByLabelText('Search emoji');
  fireEvent.change(field, { target: { value: query } });
  return field;
}

describe('skin tones in the picker', () => {
  it('applies the chosen tone when a hand is picked', () => {
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);

    fireEvent.click(screen.getByRole('button', { name: 'Medium' }));
    fireEvent.click(screen.getByRole('button', { name: ':thumbsup:' }));

    expect(onPick).toHaveBeenCalledWith('👍🏽');
  });

  it('does not tone an emoji that cannot take a modifier', () => {
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    fireEvent.click(screen.getByRole('button', { name: ':tada:' }));

    expect(onPick).toHaveBeenCalledWith('🎉');
  });

  it('remembers the tone for the next time it opens', () => {
    const first = render(<EmojiPicker onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Medium' }));
    first.unmount();

    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);

    expect(screen.getByRole('button', { name: 'Medium' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: ':thumbsup:' }));
    expect(onPick).toHaveBeenCalledWith('👍🏽');
  });
});

describe('the workspace’s own emoji', () => {
  it('come first, ahead of the Unicode set', () => {
    useStore.setState({ customEmoji: [{ name: 'shipit', url: 'https://files.test/shipit.png' }] } as never);
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);

    const [own] = screen.getAllByRole('group');
    expect(own).toBe(screen.getByRole('group', { name: 'This workspace' }));
    expect(cells()[0]).toBe(within(own!).getByRole('button', { name: ':shipit:' }));

    fireEvent.click(cells()[0]!);
    // A custom emoji is stored by its shortcode, and no tone touches it.
    expect(onPick).toHaveBeenCalledWith(':shipit:');
  });
});

describe('the picker’s keys', () => {
  it('Enter takes the first result', () => {
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);

    fireEvent.keyDown(search('tada'), { key: 'Enter' });

    expect(onPick).toHaveBeenCalledWith('🎉');
  });

  it('the arrows walk the results, and Enter takes the one under the cursor', () => {
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);
    const field = search('heart');
    expect(cells().length).toBeGreaterThan(2);
    expect(cells()[0]!.dataset.active).toBe('true');

    fireEvent.keyDown(field, { key: 'ArrowRight' });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'ArrowUp' });

    expect(cells()[1]!.dataset.active).toBe('true');
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(cells()[1]!.textContent);
  });
});

/** "Add reaction" and the picker it opens, as `MessageRow` draws them. */
function addReaction(onPick = vi.fn()) {
  render(
    <EmojiPopup
      label="React with an emoji"
      side="bottom"
      align="end"
      onPick={onPick}
      trigger={
        <button type="button" aria-label="Add reaction">
          ＋
        </button>
      }
    />,
  );
  return onPick;
}

const trigger = () => screen.getByRole('button', { name: 'Add reaction' });

/** Press the trigger and wait for the cursor to land in the search field. */
async function open() {
  trigger().focus();
  fireEvent.click(trigger());
  const picker = await screen.findByRole('dialog', { name: 'React with an emoji' });
  const field = screen.getByLabelText('Search emoji');
  await waitFor(() => expect(document.activeElement).toBe(field));
  return { picker, field };
}

describe('the picker’s popover', () => {
  it('is a dialog named by its caller, and shadcn’s throughout', async () => {
    addReaction();
    const { picker, field } = await open();

    expect(picker.getAttribute('data-slot')).toBe('popover-content');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    // Out of the legacy island it used to sit in: nothing inside is legacy CSS's any more.
    expect(field.closest('[data-legacy]')).toBeNull();
  });

  it('closes as it picks', async () => {
    const onPick = addReaction();
    await open();

    fireEvent.click(screen.getByRole('button', { name: ':tada:' }));

    expect(onPick).toHaveBeenCalledWith('🎉');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('stays open for a press inside it, and closes on one outside', async () => {
    /** A mouse press as the browser sends it, down to the click. */
    const press = (target: Element) => {
      fireEvent.pointerDown(target, { pointerType: 'mouse' });
      fireEvent.mouseDown(target);
      fireEvent.pointerUp(target, { pointerType: 'mouse' });
      fireEvent.mouseUp(target);
      fireEvent.click(target);
    };
    addReaction();
    await open();

    press(screen.getByRole('button', { name: 'Dark' }));
    press(screen.getByLabelText('Search emoji'));
    expect(screen.getByRole('dialog', { name: 'React with an emoji' })).toBeTruthy();

    press(document.body);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes on Escape and gives focus back to its trigger', async () => {
    const onPick = addReaction();
    const { field } = await open();

    fireEvent.keyDown(field, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
    expect(onPick).not.toHaveBeenCalled();
  });

  it('takes one Escape beside an open panel: the picker closes and the panel stays', async () => {
    // A panel behind the picker — the file panel, say — is a layer on the stack that was
    // there first.
    const closePanel = vi.fn();
    function Panel() {
      useEscape(closePanel);
      return null;
    }
    render(<Panel />);
    addReaction();
    const { field } = await open();

    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(closePanel).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(closePanel).toHaveBeenCalledTimes(1);
  });
});

describe('a picker pressed before its module has landed', () => {
  it('opens as it lands, with the cursor in its search', async () => {
    // In the first second after load somebody can press "Add reaction" before the module
    // is here. The press is held, and the picker opens when the module lands.
    let land!: () => void;
    const held = new Promise<void>((resolve) => {
      land = resolve;
    });
    const Late = lazyTrigger<EmojiPopoverProps>(
      () => held.then(() => import('./EmojiPopover.tsx')),
      { name: 'the emoji picker', popup: 'dialog', mount: 'press' },
    );
    render(
      <Late
        label="React with an emoji"
        side="bottom"
        align="end"
        onPick={vi.fn()}
        trigger={
          <button type="button" aria-label="Add reaction">
            ＋
          </button>
        }
      />,
    );
    trigger().focus();
    fireEvent.click(trigger());
    expect(screen.queryByRole('dialog')).toBeNull();

    await act(async () => land());

    expect(await screen.findByRole('dialog', { name: 'React with an emoji' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Search emoji')));
  });
});
