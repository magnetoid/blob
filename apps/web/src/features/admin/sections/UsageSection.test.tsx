// @vitest-environment happy-dom
/**
 * The Usage page (M2 · A9). Pinned: a partly priced row says so rather than reading as
 * cheaper than it was; an unpriced one says "no price" rather than nothing; the window
 * switches; and the price list saves only what has both prices, after checking them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api, type UsageReport } from '../../../lib/api.ts';
import { UsageSection } from './UsageSection.tsx';

const REPORT: UsageReport = {
  days: 7,
  currency: 'EUR',
  agents: [
    {
      id: 'p1',
      name: 'Janus',
      ownerName: null,
      runs: 12,
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      tokens: 1_100_000,
      cost: 4.5,
      costComplete: true,
    },
    {
      id: 'p2',
      name: 'Scout',
      ownerName: 'Bo',
      runs: 3,
      inputTokens: 200_000,
      outputTokens: 0,
      tokens: 203_000,
      cost: 0.6,
      costComplete: false,
    },
  ],
  people: [
    {
      id: 'u1',
      name: 'Ana',
      ownerName: null,
      runs: 15,
      inputTokens: 1_200_000,
      outputTokens: 100_000,
      tokens: 1_303_000,
      cost: 5.1,
      costComplete: false,
    },
  ],
  blob: [
    {
      id: null,
      name: 'summary',
      ownerName: null,
      runs: 4,
      inputTokens: 900,
      outputTokens: 300,
      tokens: 1_200,
      cost: null,
      costComplete: false,
    },
  ],
  models: [
    { model: 'claude-sonnet-5', tokens: 1_300_000, inputPerMillion: 3, outputPerMillion: 15 },
    { model: 'gpt-5', tokens: 3_000, inputPerMillion: null, outputPerMillion: null },
  ],
};

beforeEach(() => {
  vi.spyOn(api.admin, 'usage').mockResolvedValue(REPORT);
  vi.spyOn(api.admin, 'usagePrices').mockResolvedValue({
    currency: 'EUR',
    prices: [{ model: 'claude-sonnet-5', inputPerMillion: 3, outputPerMillion: 15 }],
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('what was spent', () => {
  it('lists agents, people and Blob’s own, and says where a cost is only partly priced', async () => {
    render(<UsageSection onError={vi.fn()} isOwner />);

    const agents = await screen.findByRole('table', { name: 'Agents' });
    expect(within(agents).getAllByRole('columnheader').map((head) => head.textContent)).toEqual([
      'Agent',
      'Runs',
      'Tokens',
      'Cost',
    ]);

    const janus = within(agents).getByRole('row', { name: /^Janus/ });
    expect(within(janus).getByRole('cell', { name: '12' })).toBeTruthy();
    expect(janus.textContent).toMatch(/€4\.50/);
    expect(within(janus).queryByText(/unpriced/)).toBeNull();

    // The row says whose it is, and that a cost is not the whole of what was spent.
    const scout = within(agents).getByRole('row', { name: /^Scout/ });
    expect(within(scout).getByText('Bo’s')).toBeTruthy();
    expect(within(scout).getByText(/\+ unpriced/)).toBeTruthy();

    const people = screen.getByRole('table', { name: 'People' });
    expect(within(people).getByRole('cell', { name: 'Ana' })).toBeTruthy();
    const own = screen.getByRole('table', { name: 'Blob’s own model' });
    expect(within(own).getAllByRole('columnheader')[1]!.textContent).toBe('Calls');
    const summaries = within(own).getByRole('row', { name: /^Thread summaries/ });
    expect(within(summaries).getByText('no price')).toBeTruthy();

    expect(screen.getByText(/tokens over 15 runs/).textContent).toMatch(/some tokens with no price/);
  });

  it('switches the window, and a window is always chosen', async () => {
    render(<UsageSection onError={vi.fn()} isOwner />);
    const picker = await screen.findByRole('group', { name: 'Window' });
    expect(within(picker).getByRole('button', { name: '7 days', pressed: true })).toBeTruthy();

    fireEvent.click(within(picker).getByRole('button', { name: '30 days' }));
    await waitFor(() => expect(api.admin.usage).toHaveBeenLastCalledWith(30));
    expect(within(picker).getByRole('button', { name: '30 days', pressed: true })).toBeTruthy();
    expect(within(picker).getByRole('button', { name: '7 days', pressed: false })).toBeTruthy();

    // Pressing the one that is chosen would leave no window at all.
    fireEvent.click(within(picker).getByRole('button', { name: '30 days' }));
    expect(within(picker).getByRole('button', { name: '30 days', pressed: true })).toBeTruthy();
  });

  it('says plainly when nothing ran', async () => {
    vi.spyOn(api.admin, 'usage').mockResolvedValue({
      ...REPORT,
      agents: [],
      people: [],
      blob: [],
      models: [],
    });
    vi.spyOn(api.admin, 'usagePrices').mockResolvedValue({ currency: null, prices: [] });
    render(<UsageSection onError={vi.fn()} isOwner />);
    expect(await screen.findByText('No agent ran in the last 7 days.')).toBeTruthy();
    expect(screen.getByText(/None used a model/)).toBeTruthy();
    expect(await screen.findByText(/No model has reported tokens yet/)).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Agents' })).toBeNull();
  });
});

describe('the price list', () => {
  it('offers every model seen, priced or not, and saves only what has both prices', async () => {
    const save = vi
      .spyOn(api.admin, 'setUsagePrices')
      .mockImplementation(async (prices) => prices);
    render(<UsageSection onError={vi.fn()} isOwner />);

    const gptInput = await screen.findByRole('textbox', { name: 'Input price for gpt-5' });
    const table = screen.getByRole('table', { name: 'Model prices' });
    expect(within(table).getAllByRole('columnheader').map((head) => head.textContent)).toEqual([
      'Model',
      'Seen',
      'Input / 1M',
      'Output / 1M',
    ]);
    expect(
      (screen.getByRole('textbox', { name: 'Input price for claude-sonnet-5' }) as HTMLInputElement)
        .value,
    ).toBe('3');

    // Half a price is not a price: Save waits for both, and says why where it is read — in
    // the footer's one live region, politely, since it is true from the first keystroke of
    // a price that is not finished and an alert would interrupt the typing.
    const said = screen.getByRole('status');
    expect(said.getAttribute('aria-live')).not.toBe('assertive');
    fireEvent.change(gptInput, { target: { value: '1.25' } });
    expect(said.textContent).toMatch(/Give a model both prices/);
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: 'Save prices' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Output price for gpt-5' }), {
      target: { value: '10' },
    });
    expect(said.textContent).toBe('');

    // A model typed in by hand, left unpriced, is not sent. Enter adds it, as Add does.
    const adding = screen.getByRole('textbox', { name: 'Model name' });
    fireEvent.change(adding, { target: { value: 'deepseek-v4-pro' } });
    fireEvent.keyDown(adding, { key: 'Enter' });
    expect(screen.getByRole('textbox', { name: 'Input price for deepseek-v4-pro' })).toBeTruthy();
    expect((adding as HTMLInputElement).value).toBe('');

    fireEvent.change(adding, { target: { value: 'o9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('textbox', { name: 'Output price for o9' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save prices' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        currency: 'EUR',
        prices: [
          { model: 'claude-sonnet-5', inputPerMillion: 3, outputPerMillion: 15 },
          { model: 'gpt-5', inputPerMillion: 1.25, outputPerMillion: 10 },
        ],
      }),
    );
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('takes a currency as three capital letters, and ties its hint to it', async () => {
    render(<UsageSection onError={vi.fn()} isOwner />);
    const currency = (await screen.findByRole('textbox', {
      name: 'Currency',
      description: 'Three letters, like EUR or USD.',
    })) as HTMLInputElement;
    fireEvent.change(currency, { target: { value: 'us$d' } });
    expect(currency.value).toBe('USD');
  });

  it('refuses a currency that is not finished, rather than sending it', async () => {
    render(<UsageSection onError={vi.fn()} isOwner />);
    const currency = await screen.findByRole('textbox', { name: 'Currency' });
    fireEvent.change(currency, { target: { value: 'EU' } });
    expect((screen.getByRole('button', { name: 'Save prices' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(currency.getAttribute('aria-invalid')).toBe('true');
  });
});
