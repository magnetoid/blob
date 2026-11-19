// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../test/overlayChunk.ts';
import { api } from '../../lib/api.ts';
import { WorkspaceSwitcher } from './WorkspaceSwitcher.tsx';

const WORKSPACES = [
  { id: 'w1', name: 'Imba', slug: 'imba', role: 'owner', current: true },
  { id: 'w2', name: 'Side project', slug: 'side', role: 'member', current: false },
];

function listing(workspaces: unknown[]) {
  vi.spyOn(api.workspaces, 'mine').mockResolvedValue({ workspaces } as never);
}

const assign = vi.fn();

beforeEach(() => {
  vi.stubGlobal('location', { ...window.location, assign });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  assign.mockReset();
});

describe('the workspace switcher', () => {
  it('is a plain name with one workspace', async () => {
    listing([WORKSPACES[0]]);
    render(<WorkspaceSwitcher name="Imba" />);
    await waitFor(() => expect(api.workspaces.mine).toHaveBeenCalled());
    expect(screen.getByText('Imba')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('stays a plain name when the list cannot be fetched', async () => {
    vi.spyOn(api.workspaces, 'mine').mockRejectedValue(new Error('offline'));
    render(<WorkspaceSwitcher name="Imba" />);
    await waitFor(() => expect(api.workspaces.mine).toHaveBeenCalled());
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('lists workspaces with the current one disabled', async () => {
    listing(WORKSPACES);
    render(<WorkspaceSwitcher name="Imba" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Imba' }));

    expect(await screen.findByText('Your workspaces')).toBeTruthy();
    const current = await screen.findByRole('menuitem', { name: /Imba/ });
    expect(current.getAttribute('aria-disabled')).toBe('true');
    expect(current.textContent).toContain('Current');
    const other = screen.getByRole('menuitem', { name: 'Side project' });
    expect(other.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('switches and reloads', async () => {
    listing(WORKSPACES);
    const switching = vi.spyOn(api.workspaces, 'switch').mockResolvedValue({} as never);
    render(<WorkspaceSwitcher name="Imba" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Imba' }));

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Side project' }));
    expect(switching).toHaveBeenCalledWith('w2');
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
  });
});
