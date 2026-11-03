// @vitest-environment happy-dom
/**
 * The table of what was spent, shared by the admin's Usage page and an owner's own agents.
 *
 * Its header row stays in view while the page scrolls past it. A header that is sticky
 * inside a box that scrolls sideways sticks to that box and not to the page — overflow on
 * one axis makes the box a scroll container on both — so from `md` up this table does not
 * scroll sideways (`CardTable` does). Below it, it does, as it always has: a column that
 * clips there is a column nobody can read, at 320px or at 200% text. happy-dom has no layout
 * to prove either with: the pins here are on the classes that carry the rules.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { UsageLine } from '../../lib/api.ts';
import { UsageTable } from './UsageTable.tsx';

afterEach(cleanup);

const line = (extra: Partial<UsageLine> = {}): UsageLine => ({
  id: 'p1',
  name: 'Scout',
  ownerName: 'Bo',
  runs: 3,
  inputTokens: 200_000,
  outputTokens: 3_000,
  tokens: 203_000,
  cost: 0.6,
  costComplete: true,
  ...extra,
});

describe('the usage table', () => {
  it('is named, and has a column for what each line is, its runs, tokens and cost', () => {
    render(
      <UsageTable label="What they spent" lines={[line()]} currency="EUR" heading="Agent" unit="Calls" />,
    );
    const table = screen.getByRole('table', { name: 'What they spent' });
    const heads = within(table).getAllByRole('columnheader');
    expect(heads.map((head) => head.textContent)).toEqual(['Agent', 'Calls', 'Tokens', 'Cost']);
    expect(heads.every((head) => head.getAttribute('scope') === 'col')).toBe(true);
  });

  it('says whose each line is, unless every line is the reader’s own', () => {
    const { rerender } = render(
      <UsageTable label="Agents" lines={[line()]} currency="EUR" heading="Agent" />,
    );
    expect(screen.getByText('Bo’s')).toBeTruthy();
    rerender(
      <UsageTable label="Agents" lines={[line()]} currency="EUR" heading="Agent" showOwner={false} />,
    );
    expect(screen.queryByText('Bo’s')).toBeNull();
  });

  it('names a line with nameOf, and shows a dash for tokens nobody reported', () => {
    render(
      <UsageTable
        label="Features"
        lines={[line({ name: 'summary', ownerName: null, tokens: 0, cost: null })]}
        currency={null}
        heading="Feature"
        nameOf={(entry) => (entry.name === 'summary' ? 'Thread summaries' : entry.name)}
      />,
    );
    const row = screen.getByRole('row', { name: /^Thread summaries/ });
    expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      'Thread summaries',
      '3',
      '—',
      '—',
    ]);
  });

  it('says a cost is incomplete rather than reading as cheaper than it was', () => {
    render(
      <UsageTable
        label="Agents"
        lines={[line({ id: 'a', name: 'Half', costComplete: false }), line({ id: 'b', name: 'None', cost: null })]}
        currency="EUR"
        heading="Agent"
      />,
    );
    expect(within(screen.getByRole('row', { name: /^Half/ })).getByText(/\+ unpriced/)).toBeTruthy();
    expect(within(screen.getByRole('row', { name: /^None/ })).getByText('no price')).toBeTruthy();
  });

  it('pins its header to the page from md up, and scrolls sideways below it', () => {
    render(<UsageTable label="Agents" lines={[line()]} currency="EUR" heading="Agent" />);
    const table = screen.getByRole('table', { name: 'Agents' });
    for (const head of within(table).getAllByRole('columnheader')) {
      expect(head.className).toContain('sticky');
      expect(head.className).toContain('top-0');
      // Opaque, so rows scroll out of sight under it rather than through it.
      expect(head.className).toContain('bg-card');
    }
    // shadcn's table draws a box that scrolls sideways (`overflow-x-auto`), which would
    // hold the header to itself. From `md` the wrapper takes that off the box; below it the
    // box is left as it is, so a phone can reach every column. A bare rule would clip there.
    const box = table.closest('[data-slot="table-container"]')!;
    const wrapper = box.parentElement!.className;
    expect(wrapper).toContain('md:**:data-[slot=table-container]:overflow-x-clip');
    expect(wrapper).not.toMatch(/(^|\s)\*\*:data-\[slot=table-container\]:overflow-x-clip/);
    expect(box.className).toContain('overflow-x-auto');
  });
});
