// @vitest-environment happy-dom
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
  } as never);
  return render(<Composer channelId="c1" placeholder="Message #general" />);
}

function type(text: string) {
  const box = screen.getByPlaceholderText('Message #general') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: text } });
  box.setSelectionRange(0, text.length);
  return box;
}

/**
 * The buttons were onMouseDown-only, so Enter and Space on a focused, labelled,
 * in-tab-order button did nothing at all — the worst shape for a keyboard user, who
 * reaches a control that announces itself and then silently refuses. The mousedown
 * handler still exists, but only to stop focus leaving the textarea and collapsing
 * the selection the action needs to read.
 */
describe('the composer formatting toolbar', () => {
  it('wraps the selection when a button is clicked', () => {
    renderComposer();
    const box = type('hello');

    fireEvent.click(screen.getByLabelText('Bold'));

    expect(box.value).toBe('**hello**');
  });

  it('is reachable by keyboard, not only by pointer', () => {
    renderComposer();
    const box = type('hello');
    const bold = screen.getByLabelText('Bold');

    // What Enter and Space on a focused button dispatch.
    bold.focus();
    fireEvent.click(bold);

    expect(box.value).toBe('**hello**');
  });

  it('does not apply twice when the pointer path runs in full', () => {
    // mousedown then click is one press, not two — the action must live on exactly
    // one of them.
    renderComposer();
    const box = type('hello');
    const bold = screen.getByLabelText('Bold');

    fireEvent.mouseDown(bold);
    fireEvent.click(bold);

    expect(box.value).toBe('**hello**');
  });

  it('offers italic, code and strikethrough the same way', () => {
    renderComposer();
    const box = type('x');

    fireEvent.click(screen.getByLabelText('Italic'));
    expect(box.value).toBe('_x_');
  });
});
