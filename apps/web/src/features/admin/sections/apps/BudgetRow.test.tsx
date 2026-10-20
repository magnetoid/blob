// @vitest-environment happy-dom
/** The budget row (M2 · A9 added tokens): the meter against each cap, and a save that
 * sends all three caps — a blank one lifted. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api, type AdminPlugin } from '../../../../lib/api.ts';
import { BudgetRow } from './BudgetRow.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PLUGIN = {
  id: 'p1',
  budgetRunsPerDay: null,
  budgetSecondsPerDay: null,
  budgetTokensPerDay: 50_000,
  runsLastDay: 4,
  secondsLastDay: 120,
  tokensLastDay: 51_000,
} as AdminPlugin;

describe('the budget row', () => {
  it('reads tokens against their cap, and marks the cap reached', () => {
    render(<BudgetRow plugin={PLUGIN} act={async (run) => void (await run())} />);
    const meter = screen.getByText(/in the last 24h/);
    expect(meter.textContent).toMatch(/51k tokens of 50k tokens/);
    expect(meter.getAttribute('data-over')).toBe('true');
  });

  it('sends the token cap with the others, and a blank one as lifted', async () => {
    const set = vi.spyOn(api.admin, 'setPluginBudget').mockResolvedValue(PLUGIN);
    render(<BudgetRow plugin={PLUGIN} act={async (run) => void (await run())} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Runs / day'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Tokens / day'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith('p1', {
        runsPerDay: 20,
        secondsPerDay: null,
        tokensPerDay: null,
      }),
    );
  });
});
