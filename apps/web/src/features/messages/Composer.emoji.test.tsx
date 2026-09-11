// @vitest-environment happy-dom
/**
 * `:shortcode` autocomplete in the composer.
 *
 * The picker already inserts at the caret. Typing `:tada` used to do nothing until
 * you opened that picker — Slack's fast path is the colon, not the grid.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Composer } from './Composer.tsx';
import { useStore } from '../../lib/store.ts';

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
