// @vitest-environment happy-dom
/** Tickets filed from the user menu. What these pin is the part a person could be hurt
 * by — the snapshot is markup from someone else's browser, so it is drawn in a frame that
 * is allowed nothing — and the controls: the filter is a choice of one, a ticket opens and
 * closes with its state said, and its status and deletion go to the server. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FeedbackTicket } from '@blob/shared';
import { api } from '../../../lib/api.ts';
import { useStore } from '../../../lib/store.ts';
import { FeedbackSection } from './FeedbackSection.tsx';

const ticket = (id: string, extra: Partial<FeedbackTicket> = {}): FeedbackTicket => ({
  id,
  kind: 'bug',
  title: `Ticket ${id}`,
  body: '',
  status: 'open',
  reporterId: 'u1',
  environment: {},
  consoleLog: '',
  hasSnapshot: false,
  createdAt: new Date().toISOString(),
  resolvedAt: null,
  resolvedBy: null,
  ...extra,
});

const FULL = ticket('a', {
  body: 'The send button does nothing.',
  environment: { browser: 'Firefox 150', viewport: '390x844' },
  consoleLog: 'TypeError: x is undefined',
  hasSnapshot: true,
});

beforeEach(() => {
  vi.restoreAllMocks();
  useStore.setState({ users: { u1: { id: 'u1', displayName: 'Ada Lovelace' } } } as never);
  vi.spyOn(api.feedback, 'list').mockResolvedValue({
    tickets: [FULL, ticket('b', { kind: 'feature', reporterId: null })],
  });
});

afterEach(cleanup);

const details = (title: string) => screen.getByRole('button', { name: `Details Ticket ${title}` });

describe('the filter', () => {
  it('is a choice of one, Open to begin with, and asks the server for what it chose', async () => {
    render(<FeedbackSection onError={vi.fn()} />);
    const filter = screen.getByRole('group', { name: 'Show' });
    expect(within(filter).getByRole('button', { name: 'Open', pressed: true })).toBeTruthy();
    await waitFor(() => expect(api.feedback.list).toHaveBeenLastCalledWith('open'));

    fireEvent.click(within(filter).getByRole('button', { name: 'Closed' }));
    await waitFor(() => expect(api.feedback.list).toHaveBeenLastCalledWith('closed'));
    expect(within(filter).getByRole('button', { name: 'Closed', pressed: true })).toBeTruthy();
    expect(within(filter).getByRole('button', { name: 'Open', pressed: false })).toBeTruthy();

    // Pressing the one that is chosen would leave no filter at all.
    fireEvent.click(within(filter).getByRole('button', { name: 'Closed' }));
    expect(within(filter).getByRole('button', { name: 'Closed', pressed: true })).toBeTruthy();

    fireEvent.click(within(filter).getByRole('button', { name: 'All' }));
    await waitFor(() => expect(api.feedback.list).toHaveBeenLastCalledWith(undefined));
  });

  it('says what an empty list means for the filter it is under', async () => {
    vi.spyOn(api.feedback, 'list').mockResolvedValue({ tickets: [] });
    render(<FeedbackSection onError={vi.fn()} />);
    expect(await screen.findByText(/Nothing open\. Anyone can file a ticket/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(await screen.findByText(/^Nothing here\. Anyone can file/)).toBeTruthy();
  });
});

describe('a ticket', () => {
  it('is a row: its kind, its title, and who reported it and when', async () => {
    render(<FeedbackSection onError={vi.fn()} />);
    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('bug')).toBeTruthy();
    expect(within(rows[0]!).getByText('Ticket a')).toBeTruthy();
    expect(within(rows[0]!).getByText(/^Ada Lovelace · /)).toBeTruthy();
    expect(within(rows[1]!).getByText('feature')).toBeTruthy();
    expect(within(rows[1]!).getByText(/^Someone who has since left · /)).toBeTruthy();
  });

  it('opens and closes with its state said, and names which ticket it is for', async () => {
    render(<FeedbackSection onError={vi.fn()} />);
    const button = await screen.findByRole('button', { name: 'Details Ticket a' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('The send button does nothing.')).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('The send button does nothing.')).toBeTruthy();
    // What the browser attached, as terms and their values.
    expect(screen.getByText('browser').nextElementSibling!.textContent).toBe('Firefox 150');

    fireEvent.click(button);
    expect(screen.queryByText('The send button does nothing.')).toBeNull();
  });

  it('opens one at a time', async () => {
    render(<FeedbackSection onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Details Ticket a' }));
    fireEvent.click(details('b'));
    expect(details('a').getAttribute('aria-expanded')).toBe('false');
    expect(details('b').getAttribute('aria-expanded')).toBe('true');
  });

  it('shows the console log on request, and the snapshot only in a frame that is allowed nothing', async () => {
    render(<FeedbackSection onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Details Ticket a' }));

    const log = screen.getByRole('button', { name: 'Console log', pressed: false });
    expect(screen.queryByText('TypeError: x is undefined')).toBeNull();
    fireEvent.click(log);
    expect(screen.getByText('TypeError: x is undefined')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Console log', pressed: true })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Page snapshot' }));
    // One at a time: the log gave way.
    expect(screen.queryByText('TypeError: x is undefined')).toBeNull();
    const frame = screen.getByTitle('Page snapshot for Ticket a') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe('/api/admin/feedback/a/snapshot');
    // Markup captured from someone else's browser: no scripts, no forms, no same-origin.
    expect(frame.getAttribute('sandbox')).toBe('');
  });

  it('is closed or reopened from its own detail, and the list drops it', async () => {
    const set = vi.spyOn(api.feedback, 'setStatus').mockResolvedValue({ ticket: { ...FULL, status: 'closed' } });
    render(<FeedbackSection onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Details Ticket a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(set).toHaveBeenCalledWith('a', 'closed'));
    await waitFor(() => expect(screen.queryByText('Ticket a')).toBeNull());
    expect(screen.getByText('Ticket b')).toBeTruthy();
  });

  it('is deleted by name', async () => {
    const remove = vi.spyOn(api.feedback, 'remove').mockResolvedValue({ ok: true });
    render(<FeedbackSection onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Details Ticket a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete "Ticket a"' }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('a'));
    await waitFor(() => expect(screen.queryByText('Ticket a')).toBeNull());
  });
});
