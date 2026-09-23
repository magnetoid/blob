// @vitest-environment happy-dom
/** `CallAudio` itself, and the property R31 depends on: a component that sits *outside*
 * a conditionally-swapped branch, in a stable position of the same fragment, is not
 * recreated when the branch's own content changes — which is what now lets it survive
 * Workspace's settings/admin/shell switch mid-call, where it used to be built fresh
 * inside each of the three branches (once per `callLayer(...)` call site) and so was
 * torn down and rebuilt — cutting the call's sound — every time the route crossed that
 * boundary.
 *
 * `@livekit/components-react`'s own `RoomAudioRenderer` is swapped for a double whose
 * DOM node is asserted to survive by identity — not recreated, not merely re-rendered —
 * across a branch switch: what is under test is whether React remounts the *tree*
 * CallAudio sits in, not what LiveKit itself renders inside it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';

vi.mock('@livekit/components-react', () => ({
  RoomContext: { Provider: ({ children }: { children: ReactNode }) => <>{children}</> },
  RoomAudioRenderer: () => <div data-testid="audio" />,
}));

let mockRoom: object | null = null;
vi.mock('./useCallRoom.ts', () => ({ useCallRoom: () => mockRoom }));

const { CallAudio } = await import('./CallAudio.tsx');

afterEach(cleanup);
beforeEach(() => {
  mockRoom = null;
});

describe('CallAudio', () => {
  it('renders nothing without a room', () => {
    render(<CallAudio />);
    expect(screen.queryByTestId('audio')).toBeNull();
  });

  it('renders the room audio when there is one', () => {
    mockRoom = {};
    render(<CallAudio />);
    expect(screen.getByTestId('audio')).toBeTruthy();
  });
});

describe('mounted outside a branch that swaps — the shape Workspace now uses (R31)', () => {
  it('is the same DOM node after the branch beside it changes, even across different root element types', () => {
    mockRoom = {};

    // Mirrors Workspace's `<>{body}{callAudio}</>`: `body` is what swaps per route —
    // deliberately a *different root element type* each time, the way the settings
    // Fragment and the shell's <div> differ — and `CallAudio` sits after it, outside
    // the switch, in a fragment that itself never changes shape.
    function Harness() {
      const [branch, setBranch] = useState<'shell' | 'settings'>('shell');
      const body =
        branch === 'shell' ? (
          <div data-testid="shell">shell</div>
        ) : (
          <section data-testid="settings">settings</section>
        );
      return (
        <>
          {body}
          <CallAudio />
          <button onClick={() => setBranch(branch === 'shell' ? 'settings' : 'shell')}>
            switch
          </button>
        </>
      );
    }

    render(<Harness />);
    expect(screen.getByTestId('shell')).toBeTruthy();
    const audioBefore = screen.getByTestId('audio');

    fireEvent.click(screen.getByText('switch'));

    expect(screen.queryByTestId('shell')).toBeNull();
    expect(screen.getByTestId('settings')).toBeTruthy();
    // The same node, not a same-looking replacement: React preserved the instance
    // rather than tearing it down and building a new one for the new branch.
    expect(screen.getByTestId('audio')).toBe(audioBefore);
  });

  it('WOULD be a different node sitting inside branches with different root types instead — the bug this guards against', () => {
    mockRoom = {};

    // The shape Workspace had before R31: each branch was its own early `return`, with
    // the dock's audio built fresh inside every one of them — so a switch between two
    // returns whose own root types differ (a Fragment here, a <section> there) discards
    // the whole previous tree, audio included, rather than only the part that changed.
    function BadHarness() {
      const [branch, setBranch] = useState<'a' | 'b'>('a');
      if (branch === 'a') {
        return (
          <>
            <div data-testid="a">a</div>
            <CallAudio />
            <button onClick={() => setBranch('b')}>switch</button>
          </>
        );
      }
      return (
        <section>
          <div data-testid="b">b</div>
          <CallAudio />
          <button onClick={() => setBranch('a')}>switch</button>
        </section>
      );
    }

    render(<BadHarness />);
    const audioBefore = screen.getByTestId('audio');

    fireEvent.click(screen.getByText('switch'));

    // A genuine remount — a new node, proving the identity check above really does
    // detect one, and that it is specifically the outer shape (not merely "a branch
    // changed") that causes it.
    expect(screen.getByTestId('audio')).not.toBe(audioBefore);
  });
});
