// @vitest-environment happy-dom
/**
 * Skin tones live on the picker, not on the catalog.
 *
 * Hands take a Fitzpatrick modifier; party poppers do not. The bar remembers the last
 * tone so the next 👍 is the same colour as the last, and a custom emoji is never
 * rewritten — it is an image, not a character.
 *
 * The picker's shell is Base UI's popover now, from the overlay chunk, which is here
 * before the first test (`src/test/overlayChunk.ts`); one opened before the chunk lands is
 * `Popover.chunk.test.tsx`'s. What is inside it — the search, the grid, the keys and the
 * tones — is the picker's own, and so is nothing about closing: its callers keep the open
 * state, the anchor round it, Escape and the click outside, decided by `contains` on that
 * anchor. Which is why the picker is drawn inside the anchor and not at the end of the page.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store.ts';
import { EmojiPicker } from './EmojiPicker.tsx';
import { Composer } from '../features/messages/Composer.tsx';
import '../test/overlayChunk.ts';

afterEach(cleanup);

beforeEach(() => {
  useStore.setState({ customEmoji: [] });
  window.localStorage?.clear?.();
});

describe('skin tones in the picker', () => {
  it('applies the chosen tone when a hand is picked', () => {
    const onPick = vi.fn();
    render(
      <EmojiPicker onPick={onPick} onClose={() => undefined} label="Insert an emoji" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Medium' }));
    fireEvent.click(screen.getByRole('button', { name: ':thumbsup:' }));

    expect(onPick).toHaveBeenCalledWith('👍🏽');
  });

  it('does not tone an emoji that cannot take a modifier', () => {
    const onPick = vi.fn();
    render(
      <EmojiPicker onPick={onPick} onClose={() => undefined} label="Insert an emoji" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    fireEvent.click(screen.getByRole('button', { name: ':tada:' }));

    expect(onPick).toHaveBeenCalledWith('🎉');
  });
});

describe('the picker’s keys', () => {
  function search(query: string) {
    const field = screen.getByLabelText('Search emoji');
    fireEvent.change(field, { target: { value: query } });
    return field;
  }

  it('Enter takes the first result', () => {
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} onClose={vi.fn()} label="Insert an emoji" />);

    fireEvent.keyDown(search('tada'), { key: 'Enter' });

    expect(onPick).toHaveBeenCalledWith('🎉');
  });

  it('the arrows walk the results, and Enter takes the one under the cursor', () => {
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} onClose={vi.fn()} label="Insert an emoji" />);
    const field = search('heart');
    const cells = () => [...document.querySelectorAll<HTMLElement>('.emoji-cell')];
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

  it('Escape in the search field closes without picking', () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<EmojiPicker onPick={onPick} onClose={onClose} label="Insert an emoji" />);

    fireEvent.keyDown(search('tada'), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe('the picker’s shell', () => {
  it('is a dialog named by its caller, keeping the class its caller’s stylesheet keys on', () => {
    render(<EmojiPicker onPick={vi.fn()} onClose={vi.fn()} label="Insert an emoji" />);

    const panel = screen.getByRole('dialog', { name: 'Insert an emoji' });
    expect(panel.classList.contains('emoji-picker')).toBe(true);
    expect(panel.getAttribute('data-slot')).toBe('popover-content');
    // The search, grid and tones are legacy markup, and stay legacy CSS's inside shadcn's
    // popup (`styles/app/base.css`).
    expect(screen.getByLabelText('Search emoji').closest('[data-legacy]')).toBeTruthy();
  });

  it('puts the cursor in its search field as it opens', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    render(<EmojiPicker onPick={vi.fn()} onClose={vi.fn()} label="Insert an emoji" />);

    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Search emoji')));
    trigger.remove();
  });

  it('puts it there without scrolling anything to it', async () => {
    // Above the composer, the picker is below it for a frame — where Base UI puts a panel
    // before it has read where this one hangs — and a focus that scrolls there moved the
    // whole shell up, which then kept the picker below the composer, cut to the room left.
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    render(<EmojiPicker onPick={vi.fn()} onClose={vi.fn()} label="Insert an emoji" />);

    const search = screen.getByLabelText('Search emoji');
    await waitFor(() => expect(document.activeElement).toBe(search));
    const options = focus.mock.calls.filter((_, i) => focus.mock.contexts[i] === search).map(([o]) => o);
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) expect(o).toEqual({ preventScroll: true });

    focus.mockRestore();
    trigger.remove();
  });

  it('EmojiPicker opens on its trigger and inserts the chosen emoji', async () => {
    useStore.setState({
      currentUser: { id: 'u1', kind: 'human', displayName: 'Ana', role: 'owner', prefs: { enterToSend: true } },
      users: { u1: { id: 'u1', kind: 'human', displayName: 'Ana', deactivated: false } },
      channels: { c1: { id: 'c1', kind: 'public', name: 'general', memberIds: ['u1'], membership: {} } },
      commands: [],
      drafts: {},
      customEmoji: [],
    } as never);
    render(<Composer channelId="c1" placeholder="Message #general" />);
    const box = screen.getByPlaceholderText('Message #general') as HTMLTextAreaElement;

    fireEvent.click(screen.getByRole('button', { name: 'Emoji' }));
    const picker = screen.getByRole('dialog', { name: 'Insert an emoji' });
    fireEvent.click(screen.getByRole('button', { name: 'Medium' }));
    // A click inside the picker is not a click outside it: the composer's own dismissal
    // asks `contains` of the anchor it draws round the picker.
    expect(picker.isConnected).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: ':tada:' }));

    expect(box.value).toContain('🎉');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Insert an emoji' })).toBeNull());
  });

  it('counts as inside for a caller that asks `contains` of the anchor round it', () => {
    // The composer's anchor, as `Composer` draws it: the picker is the only thing in it,
    // and a click anywhere that is not inside it closes the picker.
    const outside = vi.fn();
    function Caller() {
      const anchor = useRef<HTMLDivElement>(null);
      const [open] = useState(true);
      useEffect(() => {
        const onClick = (event: MouseEvent) => {
          if (!anchor.current?.contains(event.target as Node)) outside();
        };
        window.addEventListener('click', onClick, true);
        return () => window.removeEventListener('click', onClick, true);
      }, []);
      return (
        <div className="emoji-picker-anchor" data-composer="true" ref={anchor}>
          {open && <EmojiPicker label="Insert an emoji" onClose={vi.fn()} onPick={vi.fn()} />}
        </div>
      );
    }
    render(<Caller />);

    fireEvent.click(screen.getByRole('button', { name: ':tada:' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    fireEvent.click(screen.getByLabelText('Search emoji'));

    expect(outside).not.toHaveBeenCalled();

    fireEvent.click(document.body);

    expect(outside).toHaveBeenCalledTimes(1);
  });

  it('closes on one Escape in its search field in the composer, and the shell does not hear it', async () => {
    useStore.setState({
      currentUser: { id: 'u1', kind: 'human', displayName: 'Ana', role: 'owner', prefs: { enterToSend: true } },
      users: { u1: { id: 'u1', kind: 'human', displayName: 'Ana', deactivated: false } },
      channels: { c1: { id: 'c1', kind: 'public', name: 'general', memberIds: ['u1'], membership: {} } },
      commands: [],
      drafts: {},
      customEmoji: [],
    } as never);
    // The shell's own listener, where `Workspace` puts it: closing the thread panel on
    // Escape, marking everything read on Shift+Escape.
    const shell = vi.fn();
    window.addEventListener('keydown', shell);
    render(<Composer channelId="c1" placeholder="Message #general" />);

    fireEvent.click(screen.getByRole('button', { name: 'Emoji' }));
    const search = screen.getByLabelText('Search emoji');
    search.focus();
    fireEvent.keyDown(search, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Insert an emoji' })).toBeNull();
    expect(shell).not.toHaveBeenCalled();

    // And the next Escape, with nothing open, is the shell's again.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(shell).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', shell);
  });

  it('brings no Escape or outside click of its own: closing is its caller’s', () => {
    // One Escape closes one layer. A picker that also listened would close itself as well
    // as whatever its caller closes, or answer a key its caller had passed on.
    const onClose = vi.fn();
    render(<EmojiPicker onPick={vi.fn()} onClose={onClose} label="Insert an emoji" />);

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(document.body);

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('the picker when focus moves', () => {
  // Base UI's popover takes everything in its panel out of the tab order the moment focus
  // leaves it, and hands it back only to a focus coming in through the guards it draws round
  // the panel — which are hidden, because the panel is drawn in place (`PanelAnchor`). A
  // picker left open behind focus that had moved on could not be reached again by Tab or
  // Shift+Tab. So it closes then, by its caller's `onClose`, the way a menu does.

  /** "Add reaction" and the picker in their anchor, as `MessageRow` draws them, and the
   *  control after them in the toolbar. */
  function Toolbar({ onClose }: { onClose: () => void }) {
    return (
      <>
        <div className="emoji-picker-anchor">
          <button type="button">Add reaction</button>
          <EmojiPicker label="React with an emoji" onClose={onClose} onPick={vi.fn()} />
        </div>
        <button type="button">Reply in thread</button>
      </>
    );
  }

  it('closes when focus moves out of it — Tab past its last skin tone', () => {
    const onClose = vi.fn();
    render(<Toolbar onClose={onClose} />);

    screen.getByLabelText('Search emoji').focus();
    screen.getByRole('button', { name: 'Dark' }).focus();
    expect(onClose).not.toHaveBeenCalled();

    screen.getByRole('button', { name: 'Reply in thread' }).focus();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open for focus going nowhere, as when the window loses it', () => {
    const onClose = vi.fn();
    render(<Toolbar onClose={onClose} />);
    const search = screen.getByLabelText('Search emoji');
    search.focus();

    search.blur();

    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves a press on its own trigger to its caller, whose toggle closes it', () => {
    // Pressing a button focuses it before its click arrives. Closing on that focus would
    // have the caller's toggle open the picker again on the way back up — the trap its
    // callers already step round by leaving their trigger out of their click outside.
    const onClose = vi.fn();
    render(<Toolbar onClose={onClose} />);
    screen.getByLabelText('Search emoji').focus();
    const trigger = screen.getByRole('button', { name: 'Add reaction' });

    fireEvent.pointerDown(trigger);
    trigger.focus();
    fireEvent.pointerUp(trigger);

    expect(onClose).not.toHaveBeenCalled();

    // A key afterwards is a key again: Shift+Tab back to the trigger closes it.
    screen.getByLabelText('Search emoji').focus();
    trigger.focus();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
