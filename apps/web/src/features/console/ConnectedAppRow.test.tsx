// @vitest-environment happy-dom
/** One app signed in as a person (ADR 0029): in their own Settings, and on the admin's list
 * of everything connected. Disconnecting ends every token the app holds, so it asks first. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { OAuthGrant } from '../../lib/api.ts';
import { CardRows } from './Card.tsx';
import { ConnectedAppRow } from './ConnectedAppRow.tsx';

afterEach(cleanup);

const GRANT: OAuthGrant = {
  id: 'g1',
  clientName: 'Claude',
  vouchedBy: 'claude.ai',
  scopes: ['read'],
  createdAt: '2026-10-20T09:00:00.000Z',
  lastUsedAt: '2026-10-20T10:00:00.000Z',
};

function row(props: Partial<React.ComponentProps<typeof ConnectedAppRow>> = {}) {
  const onDisconnect = vi.fn();
  render(
    <CardRows>
      <ConnectedAppRow grant={GRANT} onDisconnect={onDisconnect} {...props} />
    </CardRows>,
  );
  return { onDisconnect, item: screen.getByRole('listitem') };
}

describe('a connected app', () => {
  it('names the app, what it may do, who confirmed it and when it last asked', () => {
    const { item } = row();
    expect(within(item).getByText('Claude')).toBeTruthy();
    expect(within(item).getByText('reads only')).toBeTruthy();
    expect(within(item).getByText(/Confirmed by claude\.ai · Last used/)).toBeTruthy();
  });

  it('says when an app has the right to post, and that one registered itself', () => {
    const { item } = row({
      grant: { ...GRANT, scopes: ['read', 'write'], vouchedBy: null, lastUsedAt: null },
    });
    expect(within(item).getByText('reads and posts')).toBeTruthy();
    expect(within(item).getByText(/Registered itself · Connected /)).toBeTruthy();
  });

  it('is named for its person on the admin’s list', () => {
    const { item } = row({ owner: 'Ana' });
    expect(within(item).getByText('Ana · Claude')).toBeTruthy();
  });

  it('disconnects only on the second press, and a second thought puts it back', () => {
    const { onDisconnect } = row({ owner: 'Ana' });
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(onDisconnect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    // Named for whose it is, so the one pressed is the one meant.
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Ana’s Claude' }));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });
});
