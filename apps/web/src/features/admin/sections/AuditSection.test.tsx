// @vitest-environment happy-dom
/**
 * The audit log: who did what, and from where, newest first, fifty at a time. Pinned: the
 * filters are the kinds of action that were seen and ask the server for just that kind; a
 * full page offers older ones, which are appended rather than replacing the list; a page
 * that answers for a filter that has since changed is dropped; and a log not read yet is
 * "loading" and never "nothing recorded".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api, type AuditEvent } from '../../../lib/api.ts';
import { AuditSection } from './AuditSection.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const event = (patch: Partial<AuditEvent>): AuditEvent => ({
  id: 'a1',
  action: 'user.role_changed',
  actorId: 'u1',
  actorName: 'Olga',
  targetType: 'user',
  targetId: 'u2',
  targetLabel: 'Max',
  metadata: {},
  ip: '10.0.0.1',
  createdAt: new Date().toISOString(),
  ...patch,
});

const PAGE = [
  event({ id: 'a3', action: 'channel.archived', targetLabel: '#old', metadata: { reason: 'quiet' } }),
  event({ id: 'a2', action: 'retention.swept', actorId: null, actorName: null, targetLabel: null, ip: null }),
  event({ id: 'a1' }),
];

/** A page as long as the server's, which is the signal that there may be older ones. */
const fullPage = (from: number) =>
  Array.from({ length: 50 }, (_, i) => event({ id: `e${String(from - i).padStart(3, '0')}` }));

describe('the audit log', () => {
  it('lists each event with its action, target, who did it and from where', async () => {
    vi.spyOn(api.admin, 'audit').mockResolvedValue({ events: PAGE });
    render(<AuditSection />);
    const list = await screen.findByRole('list', { name: 'Audit log' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);

    expect(within(rows[0]!).getByText('Archived')).toBeTruthy();
    expect(within(rows[0]!).getByText('#old')).toBeTruthy();
    expect(rows[0]!.textContent).toContain('Olga');
    expect(rows[0]!.textContent).toContain('10.0.0.1');
    expect(rows[0]!.textContent).toContain('reason: quiet');
    // Named in words where the verb alone would not say, and no one at all is Blob itself.
    expect(within(rows[1]!).getByText('Retention sweep')).toBeTruthy();
    expect(rows[1]!.textContent).toContain('Blob');
    expect(rows[1]!.textContent).not.toContain('10.0.0.1');
  });

  it('lets a long target wrap inside its row, rather than cut it off', async () => {
    const long = `#${'a-channel-name-that-is-one-long-unbroken-token-'.repeat(4)}`;
    vi.spyOn(api.admin, 'audit').mockResolvedValue({ events: [event({ targetLabel: long })] });
    render(<AuditSection />);
    const badge = await screen.findByText(long);
    // The target is data and may be one unbroken token. The card clips what overflows it, so
    // a badge that cannot wrap would lose the end of the name; it wraps (no layout here, so
    // the classes are what is pinned) and nothing is hidden.
    for (const wraps of ['h-auto', 'max-w-full', 'whitespace-normal', 'wrap-anywhere']) {
      expect(badge.className).toContain(wraps);
    }
  });

  it('says it is loading, then that nothing is recorded', async () => {
    let answer: (events: AuditEvent[]) => void = () => undefined;
    vi.spyOn(api.admin, 'audit').mockReturnValue(
      new Promise((resolve) => {
        answer = (events) => resolve({ events });
      }),
    );
    render(<AuditSection />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByText('Nothing recorded yet.')).toBeNull();
    answer([]);
    expect(await screen.findByText('Nothing recorded yet.')).toBeTruthy();
  });
});

describe('the filter', () => {
  it('offers the kinds of action seen, and asks the server for just the one chosen', async () => {
    const audit = vi.spyOn(api.admin, 'audit').mockResolvedValue({ events: PAGE });
    render(<AuditSection />);
    await screen.findByRole('list', { name: 'Audit log' });
    const filter = screen.getByRole('group', { name: 'Show' });
    expect(
      within(filter)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Everything', 'Archived', 'Retention sweep', 'Role changed']);
    expect(within(filter).getByRole('button', { name: 'Everything', pressed: true })).toBeTruthy();

    audit.mockResolvedValue({ events: [PAGE[0]!] });
    fireEvent.click(within(filter).getByRole('button', { name: 'Archived' }));
    await waitFor(() => expect(audit).toHaveBeenLastCalledWith({ action: 'channel.archived' }));
    expect(within(filter).getByRole('button', { name: 'Archived', pressed: true })).toBeTruthy();
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: 'Audit log' })).getAllByRole('listitem')).toHaveLength(1),
    );

    // Pressing the one that is chosen leaves it chosen: no filter at all is "Everything".
    fireEvent.click(within(filter).getByRole('button', { name: 'Archived' }));
    expect(within(filter).getByRole('button', { name: 'Archived', pressed: true })).toBeTruthy();

    audit.mockResolvedValue({ events: PAGE });
    fireEvent.click(within(filter).getByRole('button', { name: 'Everything' }));
    await waitFor(() => expect(audit).toHaveBeenLastCalledWith({ action: undefined }));
  });
});

describe('older events', () => {
  it('offers them only after a full page, appends them, and stops when the log runs out', async () => {
    const audit = vi
      .spyOn(api.admin, 'audit')
      .mockResolvedValueOnce({ events: fullPage(100) })
      .mockResolvedValueOnce({ events: [event({ id: 'a-last', action: 'channel.archived' })] });
    render(<AuditSection />);
    const more = await screen.findByRole('button', { name: 'Load older' });

    fireEvent.click(more);
    // Asked for what came before the oldest one shown.
    await waitFor(() => expect(audit).toHaveBeenLastCalledWith({ action: undefined, before: 'e051' }));
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: 'Audit log' })).getAllByRole('listitem')).toHaveLength(51),
    );
    expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
  });

  it('keeps focus on the button while it loads, which is inert, not gone', async () => {
    let answer: (events: AuditEvent[]) => void = () => undefined;
    vi.spyOn(api.admin, 'audit')
      .mockResolvedValueOnce({ events: fullPage(100) })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          answer = (events) => resolve({ events });
        }),
      );
    render(<AuditSection />);
    const more = await screen.findByRole('button', { name: 'Load older' });
    more.focus();
    fireEvent.click(more);

    const busy = await screen.findByRole('button', { name: 'Loading…' });
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    expect(busy.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(busy);
    answer([]);
    await screen.findByRole('list', { name: 'Audit log' });
  });

  it('drops older events that arrive for a filter that has since changed', async () => {
    let late: (events: AuditEvent[]) => void = () => undefined;
    const audit = vi.spyOn(api.admin, 'audit').mockImplementation(async (params) => {
      if (params?.before) {
        return new Promise((resolve) => {
          late = (events) => resolve({ events });
        });
      }
      return { events: params?.action ? [PAGE[0]!] : fullPage(100) };
    });
    render(<AuditSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load older' }));
    await waitFor(() => expect(audit).toHaveBeenCalledWith(expect.objectContaining({ before: 'e051' })));

    // The filter changes while the older page is on its way.
    fireEvent.click(screen.getByRole('button', { name: 'Role changed' }));
    await waitFor(() => expect(audit).toHaveBeenLastCalledWith({ action: 'user.role_changed' }));
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: 'Audit log' })).getAllByRole('listitem')).toHaveLength(1),
    );

    late([event({ id: 'stale' })]);
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(within(screen.getByRole('list', { name: 'Audit log' })).getAllByRole('listitem')).toHaveLength(1);
  });
});
