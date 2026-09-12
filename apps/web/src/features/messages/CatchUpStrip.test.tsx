// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CatchUpStrip } from './CatchUpStrip.tsx';
import { useStore } from '../../lib/store.ts';

afterEach(cleanup);

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
  });
});
