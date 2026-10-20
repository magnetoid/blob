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

function card(title: string) {
  return within(screen.getByRole('heading', { name: title }).closest('section')!);
}

describe('what was spent', () => {
  it('lists agents, people and Blob’s own, and says where a cost is only partly priced', async () => {
    render(<UsageSection onError={vi.fn()} isOwner />);
    // The heading is drawn before the numbers arrive; the first row is not.
    await screen.findByText('Janus');

    const janus = card('Agents').getByText('Janus').closest('tr')!;
    expect(within(janus).getByText('12')).toBeTruthy();
    expect(janus.textContent).toMatch(/€4\.50/);
    expect(within(janus).queryByText(/unpriced/)).toBeNull();

    const scout = card('Agents').getByText('Scout').closest('tr')!;
    expect(within(scout).getByText('Bo’s')).toBeTruthy();
    expect(within(scout).getByText(/\+ unpriced/)).toBeTruthy();

    expect(card('People').getByText('Ana')).toBeTruthy();
    const summaries = card('Blob’s own model').getByText('Thread summaries').closest('tr')!;
    expect(within(summaries).getByText('no price')).toBeTruthy();

    expect(screen.getByText(/tokens over 15 runs/).textContent).toMatch(/some tokens with no price/);
  });

  it('switches the window', async () => {
    render(<UsageSection onError={vi.fn()} isOwner />);
    fireEvent.click(await screen.findByRole('button', { name: '30 days' }));
    await waitFor(() => expect(api.admin.usage).toHaveBeenLastCalledWith(30));
    expect(screen.getByRole('button', { name: '30 days' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
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
  });
});

describe('the price list', () => {
  it('offers every model seen, priced or not, and saves only what has both prices', async () => {
    const save = vi
      .spyOn(api.admin, 'setUsagePrices')
      .mockImplementation(async (prices) => prices);
    render(<UsageSection onError={vi.fn()} isOwner />);

    const gptInput = await screen.findByRole('textbox', { name: 'Input price for gpt-5' });
    expect(
      (screen.getByRole('textbox', { name: 'Input price for claude-sonnet-5' }) as HTMLInputElement)
        .value,
    ).toBe('3');

    // Half a price is not a price: Save waits for both.
    fireEvent.change(gptInput, { target: { value: '1.25' } });
    expect(screen.getByText(/Give a model both prices/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save prices' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Output price for gpt-5' }), {
      target: { value: '10' },
    });

    // A model typed in by hand, left unpriced, is not sent.
    fireEvent.change(screen.getByRole('textbox', { name: 'Model name' }), {
      target: { value: 'deepseek-v4-pro' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('textbox', { name: 'Input price for deepseek-v4-pro' })).toBeTruthy();

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

  it('takes a currency as three capital letters', async () => {
    render(<UsageSection onError={vi.fn()} isOwner />);
    const currency = (await screen.findByRole('textbox', { name: /Currency/ })) as HTMLInputElement;
    fireEvent.change(currency, { target: { value: 'us$d' } });
    expect(currency.value).toBe('USD');
  });
});
