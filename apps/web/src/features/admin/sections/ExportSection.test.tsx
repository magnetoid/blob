// @vitest-environment happy-dom
/**
 * Admin → Export (M3 · B4): the workspace's export, on its own page. The card is
 * `ExportsCard`'s and is tested there; what this pins is that the page asks for the
 * workspace's exports and says what an export leaves out.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { api } from '../../../lib/api.ts';
import { ExportSection } from './ExportSection.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the Export page', () => {
  it('is the workspace’s export, not the person’s, and says what it never holds', async () => {
    const workspace = vi.spyOn(api.admin, 'exports').mockResolvedValue({ exports: [] });
    const personal = vi.spyOn(api.me, 'exports').mockResolvedValue({ exports: [] });
    render(<ExportSection />);

    const heading = await screen.findByRole('heading', { name: 'Export the workspace' });
    const card = heading.closest('[data-slot="card"]') as HTMLElement;
    expect(within(card).getByText(/Private channels and direct messages are never included/)).toBeTruthy();
    expect(await within(card).findByText(/Nothing exported yet/)).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Export' })).toBeTruthy();
    expect(workspace).toHaveBeenCalled();
    expect(personal).not.toHaveBeenCalled();
  });
});
