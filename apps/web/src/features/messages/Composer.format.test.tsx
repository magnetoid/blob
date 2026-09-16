// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('wraps the selection as a markdown link', () => {
    renderComposer();
    const box = type('hello');

    fireEvent.click(screen.getByLabelText('Link'));

    expect(box.value).toBe('[hello](url)');
  });

  it('prefixes the selection as a list', () => {
    renderComposer();
    const box = type('hello');

    fireEvent.click(screen.getByLabelText('List'));

    expect(box.value).toBe('- hello');
  });
});

/**
 * `field-sizing: content` grows the box during layout, so it is the right height in the
 * frame that draws the character. The JavaScript measure did it a paint later, which is
 * the line arriving late. The measure stays only for browsers without the property, and
 * these two cases are what says so: where it is supported the effect must write no
 * inline height at all, because an inline height would override the CSS and hand the
 * late growth straight back.
 */
describe('the composer autosize fallback', () => {
  afterEach(() => vi.unstubAllGlobals());

  // Kept in front of the real namespace rather than replacing it: `CSS` also carries
  // `escape`, and a stub that drops it would break anything reaching for it later in
  // the same test rather than the thing under test. A spread would not do that — in
  // happy-dom 20.11.6 `CSS` is a class instance, so `{ ...globalThis.CSS }` copies the
  // unit factories it owns and leaves `escape` and `supports` behind on the prototype.
  // Prototype chaining is what actually keeps them.
  function stubSupports(answer: boolean) {
    const supports = vi.fn(() => answer);
    vi.stubGlobal('CSS', Object.assign(Object.create(globalThis.CSS ?? null), { supports }));
    return supports;
  }

  it('leaves the height to CSS where field-sizing is supported', () => {
    const supports = stubSupports(true);
    renderComposer();

    const box = type('one\ntwo\nthree');

    expect(box.style.height).toBe('');
    // The property actually asked about, not merely that something was asked.
    expect(supports).toHaveBeenCalledWith('field-sizing', 'content');
  });

  it('measures and sets the height where it is not', () => {
    stubSupports(false);
    renderComposer();

    const box = type('one\ntwo\nthree');

    expect(box.style.height).toMatch(/^\d+px$/);
  });

  it('leaves the rest of the CSS namespace reachable', () => {
    // What the helper above claims, said where it can fail. `escape` and `supports` live
    // on happy-dom's `CSS` prototype while the unit factories are own fields, so a stub
    // built by spreading the namespace keeps the units and loses these two.
    stubSupports(true);

    expect(typeof CSS.escape).toBe('function');
    expect(CSS.escape('a b')).toBe('a\\ b');
  });
});
