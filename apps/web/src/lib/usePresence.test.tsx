// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { usePresence } from './usePresence.ts';

afterEach(cleanup);

function Panel({ open }: { open: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { present, state } = usePresence(open, ref);
  if (!present) return null;
  return <div ref={ref} data-testid="panel" data-state={state} />;
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

  it('does not animate out something that was never open', () => {
    // A panel rendered closed has no exit to play; showing one would flash it.
    const { rerender } = render(<Panel open={false} />);
    rerender(<Panel open={false} />);
    expect(screen.queryByTestId('panel')).toBeNull();
  });
});
