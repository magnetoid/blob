// @vitest-environment happy-dom
/**
 * Emoji in the composer: the `:shortcode` autocomplete, and the picker behind the Emoji
 * button.
 *
 * The picker inserts at the caret. Typing `:tada` used to do nothing until you opened that
 * picker — Slack's fast path is the colon, not the grid.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Composer } from './Composer.tsx';
import { EmojiPopup } from './lazyPopups.ts';
import { useStore } from '../../lib/store.ts';

await EmojiPopup.preload();

afterEach(cleanup);

function renderComposer() {
  useStore.setState({
    currentUser: { id: 'u1', kind: 'human', displayName: 'Ana', role: 'owner', prefs: { enterToSend: true } },
    users: { u1: { id: 'u1', kind: 'human', displayName: 'Ana', deactivated: false } },
    channels: { c1: { id: 'c1', kind: 'public', name: 'general', memberIds: ['u1'], membership: {} } },
    commands: [],
    drafts: {},
    customEmoji: [{ name: 'shipit', url: 'https://files.test/shipit.png' }],
  } as never);
  return render(<Composer channelId="c1" placeholder="Message #general" />);
}

function typeAtEnd(text: string) {
  const box = screen.getByPlaceholderText('Message #general') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: text } });
  box.setSelectionRange(text.length, text.length);
  // Re-dispatch so updateDraft sees the caret at the end (happy-dom leaves it at 0
  // through the first change).
  fireEvent.change(box, { target: { value: text } });
  return box;
}

describe('colon autocomplete', () => {
  it('offers a matching emoji after a colon', () => {
    renderComposer();
    typeAtEnd(':tada');

    expect(screen.getByRole('listbox').textContent).toContain('tada');
  });

  it('inserts the character and closes the list', () => {
    renderComposer();
    const box = typeAtEnd(':tada');

    fireEvent.mouseDown(screen.getByRole('option', { name: ':tada:' }));

    expect(box.value).toContain('🎉');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('offers a workspace emoji the same way', () => {
    renderComposer();
    typeAtEnd(':ship');

    expect(screen.getByRole('listbox').textContent).toContain('shipit');
  });
});

describe('the emoji picker', () => {
  it('inserts at the caret and gives focus back to the message field', async () => {
    renderComposer();
    const box = typeAtEnd('hello world');
    box.setSelectionRange(5, 5);

    fireEvent.click(screen.getByRole('button', { name: 'Emoji' }));
    await screen.findByRole('dialog', { name: 'Insert an emoji' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Search emoji')));
    fireEvent.click(screen.getByRole('button', { name: ':tada:' }));

    expect(box.value).toBe('hello🎉  world');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(box));
    // And it stays there: nothing hands it back to the Emoji button once the picker is gone.
    await act(() => new Promise((done) => setTimeout(done, 50)));
    expect(document.activeElement).toBe(box);
    expect(box.selectionStart).toBe('hello🎉 '.length);
    expect(box.selectionEnd).toBe('hello🎉 '.length);
  });
});
