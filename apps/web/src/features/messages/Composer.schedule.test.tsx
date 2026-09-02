// @vitest-environment happy-dom
/** The clock beside Send, and the one thing it cannot carry.
 *
 * Scheduling sends the body and nothing else: `scheduled_messages` has no link to an
 * attachment row, and the orphan sweep collects an attachment no message claims — so a
 * file scheduled for next week would be deleted before its message went out. The clock
 * was offered anyway. With a file and no text it produced a schema violation shown to
 * somebody whose composer visibly held a file ("String should have at least 1
 * character"); with text *and* a file it succeeded, cleared the text, left the chip
 * sitting in the tray, and sent a message with no file on it a week later.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Composer } from './Composer.tsx';
import { useStore } from '../../lib/store.ts';

afterEach(cleanup);

function renderComposer() {
  useStore.setState({
    currentUser: {
      id: 'u1',
      kind: 'human',
      displayName: 'Ana',
      role: 'owner',
      prefs: { enterToSend: true },
    },
    users: { u1: { id: 'u1', kind: 'human', displayName: 'Ana', deactivated: false } },
    channels: {
      c1: { id: 'c1', kind: 'public', name: 'general', memberIds: ['u1'], membership: {} },
    },
    commands: [],
    drafts: {},
  } as never);
  return render(<Composer channelId="c1" placeholder="Message #general" />);
}

function type(text: string) {
  const box = screen.getByPlaceholderText('Message #general') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: text } });
  return box;
}

function attach(name: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['x'], name, { type: 'text/plain' });
  fireEvent.change(input, { target: { files: [file] } });
}

function clock() {
  return document.querySelector('.schedule-trigger') as HTMLButtonElement;
}

describe('the send-later clock', () => {
  it('is offered for a message that is only words', () => {
    renderComposer();
    type('later, please');

    expect(clock().disabled).toBe(false);
  });

  it('is not offered while the tray holds a file', () => {
    renderComposer();
    type('here is the deck');
    attach('deck.pdf');

    expect(clock().disabled).toBe(true);
  });

  it('says why rather than merely refusing', () => {
    renderComposer();
    type('here is the deck');
    attach('deck.pdf');

    // A disabled control with no explanation reads as a broken one.
    expect(clock().getAttribute('data-tooltip')).toContain('can’t be scheduled');
    expect(clock().getAttribute('aria-label')).toContain('send this now');
  });

  it('comes back once the file is taken out again', () => {
    renderComposer();
    type('here is the deck');
    attach('deck.pdf');

    fireEvent.click(screen.getByTitle('Remove deck.pdf'));

    expect(clock().disabled).toBe(false);
  });
});
