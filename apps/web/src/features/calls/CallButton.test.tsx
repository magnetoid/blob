// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const startCall = vi.fn();
vi.mock('../../lib/calls.ts', () => ({ startCall }));

const { useStore } = await import('../../lib/store.ts');
const { CallButton } = await import('./CallButton.tsx');

afterEach(cleanup);

describe('the call button in a channel header', () => {
  beforeEach(() => {
    startCall.mockReset();
    useStore.setState({
      activeCalls: {},
      callSession: null,
      users: { u1: { id: 'u1', displayName: 'Ana' }, u2: { id: 'u2', displayName: 'Devin' } } as never,
    });
  });

  it('starts one when none is live', () => {
    render(<CallButton channelId="ch-1" kind="meetup" />);
    fireEvent.click(screen.getByRole('button', { name: 'Start a meetup' }));
    expect(startCall).toHaveBeenCalledWith('ch-1', 'meetup');
  });

  it('shows who is in a live one and offers to join', () => {
    useStore.setState({
      activeCalls: {
        c1: {
          id: 'c1', channelId: 'ch-1', kind: 'meetup', createdBy: 'u1', status: 'active',
          createdAt: '', endedAt: null, participantIds: ['u1', 'u2'],
        },
      },
    });
    render(<CallButton channelId="ch-1" kind="meetup" />);
    const button = screen.getByRole('button', { name: 'Join the meetup — 2 in it' });
    expect(button.getAttribute('data-live')).toBe('true');
    expect(button.textContent).toContain('Join');
  });

  it('says so when you are in it', () => {
    useStore.setState({
      activeCalls: {
        c1: {
          id: 'c1', channelId: 'ch-1', kind: 'meetup', createdBy: 'u1', status: 'active',
          createdAt: '', endedAt: null, participantIds: ['u1'],
        },
      },
      callSession: { callId: 'c1', channelId: 'ch-1', kind: 'meetup', phase: 'connected' },
    });
    render(<CallButton channelId="ch-1" kind="meetup" />);
    expect(screen.getByRole('button', { name: 'You’re in this meetup — open it' })).toBeTruthy();
  });
});
