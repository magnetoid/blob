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
    // Not only a colour: a reader is told the cap is reached.
    expect(meter.textContent).toMatch(/limit reached/);
  });

  it('does not say a cap is reached while there is room under it', () => {
    render(
      <BudgetRow
        plugin={{ ...PLUGIN, tokensLastDay: 10_000 }}
        act={async (run) => void (await run())}
      />,
    );
    const meter = screen.getByText(/in the last 24h/);
    expect(meter.getAttribute('data-over')).toBeNull();
    expect(meter.textContent).not.toMatch(/limit reached/);
  });

  it('reads as unlimited with no cap, and offers to set one', () => {
    render(
      <BudgetRow
        plugin={{ ...PLUGIN, budgetTokensPerDay: null, tokensLastDay: 0 }}
        act={async (run) => void (await run())}
      />,
    );
    expect(screen.getByText('Budget: unlimited')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set a budget' })).toBeTruthy();
  });

  it('sends the token cap with the others, and a blank one as lifted', async () => {
    const set = vi.spyOn(api.admin, 'setPluginBudget').mockResolvedValue(PLUGIN);
    render(<BudgetRow plugin={PLUGIN} act={async (run) => void (await run())} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Runs / day' }), { target: { value: '20' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Tokens / day' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith('p1', {
        runsPerDay: 20,
        secondsPerDay: null,
        tokensPerDay: null,
      }),
    );
  });

  it('says what the token cap counts, as the hint of the field it belongs to', () => {
    render(<BudgetRow plugin={PLUGIN} act={async (run) => void (await run())} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(
      screen.getByRole('spinbutton', {
        name: 'Tokens / day',
        description: /Counts the tokens the agent reports/,
      }),
    ).toBeTruthy();
  });

  it('sends minutes as the seconds the server stores', async () => {
    const set = vi.spyOn(api.admin, 'setPluginBudget').mockResolvedValue(PLUGIN);
    render(<BudgetRow plugin={PLUGIN} act={async (run) => void (await run())} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Minutes / day' }), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith('p1', {
        runsPerDay: null,
        secondsPerDay: 900,
        tokensPerDay: 50_000,
      }),
    );
  });

  it('sends nothing for a cap that is not a whole number of at least one, and stays open', () => {
    const set = vi.spyOn(api.admin, 'setPluginBudget').mockResolvedValue(PLUGIN);
    render(<BudgetRow plugin={PLUGIN} act={async (run) => void (await run())} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Runs / day' }), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(set).not.toHaveBeenCalled();
    expect(screen.getByRole('spinbutton', { name: 'Runs / day' })).toBeTruthy();
  });

  it('puts the edit away on Cancel without sending', () => {
    const set = vi.spyOn(api.admin, 'setPluginBudget').mockResolvedValue(PLUGIN);
    render(<BudgetRow plugin={PLUGIN} act={async (run) => void (await run())} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('spinbutton', { name: 'Runs / day' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(set).not.toHaveBeenCalled();
  });
});
