// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { usePresence } from './usePresence.ts';

afterEach(cleanup);

function Panel({ open }: { open: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { present, state } = usePresence(open, ref);
  if (!present) return null;
  return (
    <div ref={ref} data-testid="panel" data-state={state}>
      {/* Every real caller holds a subtree, not a leaf: the thread panel alone contains
          reaction chips, counts, attachment chips and a message flash, each with a
          keyframe of its own whose `animationend` bubbles up to here. */}
      <span data-testid="panel-child" />
    </div>
  );
}

function Harness({ initial }: { initial: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <>
      <button onClick={() => setOpen((v) => !v)}>toggle</button>
      <Panel open={open} />
    </>
  );
}

describe('usePresence', () => {
  it('renders nothing while closed', () => {
    render(<Harness initial={false} />);
    expect(screen.queryByTestId('panel')).toBeNull();
  });

  it('is present and open straight away when opened', () => {
    render(<Harness initial={true} />);
    const panel = screen.getByTestId('panel');
    expect(panel.getAttribute('data-state')).toBe('open');
  });

  it('stays mounted through the exit, then leaves', async () => {
    // The whole reason the hook exists: React would drop the node on the render that
    // closed it, so there would be nothing left to animate.
    render(<Harness initial={true} />);
    screen.getByText('toggle').click();

    await waitFor(() =>
      expect(screen.getByTestId('panel').getAttribute('data-state')).toBe('closed'),
    );
    await waitFor(() => expect(screen.queryByTestId('panel')).toBeNull());
  });

  it('unmounts on animationend rather than waiting out the fallback', async () => {
    render(<Harness initial={true} />);
    screen.getByText('toggle').click();
    await waitFor(() =>
      expect(screen.getByTestId('panel').getAttribute('data-state')).toBe('closed'),
    );

    screen.getByTestId('panel').dispatchEvent(new Event('animationend'));

    await waitFor(() => expect(screen.queryByTestId('panel')).toBeNull());
  });

  it('ignores an animation that ended somewhere inside the node it is holding', async () => {
    // `animationend` bubbles, so a 120ms `reaction-pop` landing in the thread panel
    // during its 150ms exit used to finish the exit for it and cut the panel instead of
    // sliding it away. Only the node's own animation ends the hold.
    render(<Harness initial={true} />);
    screen.getByText('toggle').click();
    await waitFor(() =>
      expect(screen.getByTestId('panel').getAttribute('data-state')).toBe('closed'),
    );

    act(() => {
      screen
        .getByTestId('panel-child')
        .dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(screen.getByTestId('panel').getAttribute('data-state')).toBe('closed');

    // And the node's own still does, so the hold is not simply deaf now.
    act(() => {
      screen.getByTestId('panel').dispatchEvent(new Event('animationend'));
    });
    expect(screen.queryByTestId('panel')).toBeNull();
  });

  it('does not animate out something that was never open', () => {
    // A panel rendered closed has no exit to play; showing one would flash it.
    const { rerender } = render(<Panel open={false} />);
    rerender(<Panel open={false} />);
    expect(screen.queryByTestId('panel')).toBeNull();
  });
});
