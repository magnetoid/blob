// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CatchUpStrip } from './CatchUpStrip.tsx';
import { useStore } from '../../lib/store.ts';
import { FALLBACK_MS } from '../../lib/usePresence.ts';

/** Past usePresence's fallback, which is what ends an exit here: happy-dom runs no
 *  animations, so the `animationend` a browser would send never comes. */
const EXIT_SETTLED_MS = FALLBACK_MS + 100;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the catch-up strip', () => {
  it('says nothing when there is nothing unread', () => {
    const { container } = render(
      <CatchUpStrip hasUnread={false} mentionCount={3} onDismiss={vi.fn()} />,
    );

    expect(container.querySelector('.catchup-strip')).toBeNull();
  });

  it('offers the recap when there is a backlog', () => {
    render(<CatchUpStrip hasUnread mentionCount={0} onDismiss={vi.fn()} />);

    expect(screen.getByText('While you were away')).toBeTruthy();
    expect(screen.getByText('Read catch-up →')).toBeTruthy();
  });

  it('does not claim to know what happened, only that something did', () => {
    // The design draws a written recap here. Producing one is a model call over
    // everything unread, and a server with no model answers it with a keyword scan —
    // so the strip names the offer and the panel behind it does the summarising.
    render(<CatchUpStrip hasUnread mentionCount={0} onDismiss={vi.fn()} />);

    expect(screen.getByText(/there are new messages here\./)).toBeTruthy();
  });

  it('counts the ones that name you', () => {
    render(<CatchUpStrip hasUnread mentionCount={2} onDismiss={vi.fn()} />);

    expect(screen.getByText(/2 of them mention you\./)).toBeTruthy();
  });

  it('says "mentions" for one', () => {
    render(<CatchUpStrip hasUnread mentionCount={1} onDismiss={vi.fn()} />);

    expect(screen.getByText(/1 of them mentions you\./)).toBeTruthy();
  });

  it('opens the panel scoped to this channel, not the whole workspace', () => {
    useStore.setState({ catchupScope: null } as never);
    render(<CatchUpStrip hasUnread mentionCount={0} onDismiss={vi.fn()} />);

    fireEvent.click(screen.getByText('Read catch-up →'));
    expect(useStore.getState().catchupScope).toBe('channel');
  });

  it('can be waved away', () => {
    const onDismiss = vi.fn();
    render(<CatchUpStrip hasUnread mentionCount={0} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByLabelText('Dismiss catch-up'));
    expect(onDismiss).toHaveBeenCalled();
    // And does nothing else on its own: the strip does not take itself down on the click,
    // it reports and waits to be told. Whether the telling happens is ChannelView's, and
    // is pinned by the source check at the bottom of this file — this only says the strip
    // has no second, private route out.
    expect(screen.getByText('While you were away')).toBeTruthy();
  });

  it('is marked open while it is up, so the stylesheet can tell it from one leaving', () => {
    const { container } = render(<CatchUpStrip hasUnread mentionCount={0} onDismiss={vi.fn()} />);

    const strip = container.querySelector('.catchup-strip')!;
    expect(strip.getAttribute('data-state')).toBe('open');
    expect(strip.hasAttribute('inert')).toBe(false);
  });

  it('stays in the document for its exit, still saying what it said', () => {
    // Reading the channel clears the backlog and the mention count in one commit, so a
    // strip that kept rendering from the props would spend its exit rewriting its own
    // sentence — and React would have dropped the node before it could animate at all.
    vi.useFakeTimers();
    const { container, rerender } = render(
      <CatchUpStrip hasUnread mentionCount={2} onDismiss={vi.fn()} />,
    );

    rerender(<CatchUpStrip hasUnread={false} mentionCount={0} onDismiss={vi.fn()} />);

    const leaving = container.querySelector('.catchup-strip');
    expect(leaving).toBeTruthy();
    expect(leaving!.getAttribute('data-state')).toBe('closed');
    expect(leaving!.textContent).toContain('2 of them mention you');
    // Out of the tab order and the accessibility tree for the 150ms it is still there.
    expect(leaving!.hasAttribute('inert')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(EXIT_SETTLED_MS);
    });

    expect(container.querySelector('.catchup-strip')).toBeNull();
  });
});

/**
 * How ChannelView mounts it, read from the source — the same device, and for the same
 * reason, as the `MessageList.leak.test.tsx` call-site check.
 *
 * Both of these are mistakes that look right. `{!dismissed && <CatchUpStrip/>}` is the
 * obvious way to write a dismissal and is what this was before; it takes the strip out of
 * the tree on the click, and a component that is gone has nothing left to animate. And a
 * held component with no key survives a channel switch, so the strip either finishes the
 * last channel's exit over this one's messages or rewrites its sentence in place instead
 * of arriving. Rendering ChannelView to prove either would mean a harness for a 500-line
 * component — the store, the API, the socket and the virtualizer's geometry — to assert
 * two attributes of one JSX tag.
 */
describe('how the channel view mounts it', () => {
  // `import.meta.dirname`, not `new URL(path, import.meta.url)`: happy-dom installs its
  // own `URL`, which resolves against the document (`http://localhost:3000/`) and ignores
  // the base it is handed, so the file URL never survives to `readFileSync`.
  function channelView() {
    const source = readFileSync(`${import.meta.dirname}/ChannelView.tsx`, 'utf8');
    const opening = source.indexOf('<CatchUpStrip');
    expect(opening).toBeGreaterThan(-1);
    return { source, tag: source.slice(opening, source.indexOf('/>', opening)) };
  }

  it('tells the strip it was dismissed instead of unmounting it', () => {
    const { source, tag } = channelView();
    expect(tag).toMatch(/hasUnread=\{[^}]*dismissedCatchUp/);
    expect(source).not.toMatch(/dismissedCatchUp\.has\([^)]*\)\s*&&\s*\(?\s*<CatchUpStrip/);
  });

  it('gives it a per-channel identity, so a switch does not inherit the last one', () => {
    expect(channelView().tag).toMatch(/key=\{activeChannelId\}/);
  });
});
