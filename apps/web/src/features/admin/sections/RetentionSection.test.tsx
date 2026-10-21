// @vitest-environment happy-dom
/**
 * The Retention page (ADR 0039). Pinned: a draft says about what the first sweep would take
 * before it is saved; saving a window that removes anything asks first, while keeping
 * everything does not; a hold is placed in two clicks and released only after a warning.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api, type RetentionView } from '../../../lib/api.ts';
import { RetentionSection } from './RetentionSection.tsx';

const NOTHING: RetentionView = {
  messageDays: null,
  fileDays: null,
  changedAt: null,
  takesEffectAt: null,
  nextSweepAt: null,
  lastSweep: null,
  heldConversations: [],
  heldPeople: [],
};

const KEPT_A_YEAR: RetentionView = {
  ...NOTHING,
  messageDays: 365,
  changedAt: '2026-10-01T09:00:00Z',
  nextSweepAt: '2026-10-22T04:40:00Z',
  lastSweep: { at: '2026-10-21T04:40:00Z', messages: 12, files: 3 },
  heldConversations: [
    { id: 'c9', kind: 'private', name: 'lawsuit', heldAt: '2026-10-02T10:00:00Z', heldBy: 'Olga' },
  ],
  heldPeople: [{ id: 'u9', displayName: 'Max', heldAt: '2026-10-03T10:00:00Z', heldBy: 'Olga' }],
};

beforeEach(() => {
  vi.spyOn(api.admin, 'retentionPreview').mockResolvedValue({
    messages: 1234,
    files: 5,
    capped: false,
  });
  vi.spyOn(api.admin, 'setRetention').mockResolvedValue(NOTHING);
  vi.spyOn(api.admin, 'holdConversation').mockResolvedValue({ ok: true });
  vi.spyOn(api.admin, 'holdPerson').mockResolvedValue({ ok: true });
  vi.spyOn(api.admin, 'channels').mockResolvedValue({
    channels: [
      { id: 'c1', kind: 'public', name: 'general' },
      { id: 'c9', kind: 'private', name: 'lawsuit' },
      { id: 'd1', kind: 'dm', name: null },
    ] as never,
  });
  vi.spyOn(api.admin, 'users').mockResolvedValue({
    users: [
      { id: 'u1', displayName: 'Olga' },
      { id: 'u9', displayName: 'Max' },
    ] as never,
    total: 2,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function card(title: string) {
  return within(screen.getByRole('heading', { name: title }).closest('section')!);
}

describe('the windows', () => {
  it('says Blob keeps everything when nothing is set', async () => {
    vi.spyOn(api.admin, 'retention').mockResolvedValue(NOTHING);
    render(<RetentionSection />);
    expect(await screen.findByText('Blob keeps every message and file.')).toBeTruthy();
  });

  it('counts what a draft would remove, and asks before saving it', async () => {
    vi.spyOn(api.admin, 'retention').mockResolvedValue(NOTHING);
    render(<RetentionSection />);
    fireEvent.change(await screen.findByLabelText('Messages'), { target: { value: '90' } });

    await waitFor(() =>
      expect(api.admin.retentionPreview).toHaveBeenCalledWith({ messageDays: 90, fileDays: null }),
    );
    expect(
      await screen.findByText('The first sweep would remove about 1,234 messages and 5 files.'),
    ).toBeTruthy();

    fireEvent.click(card('How long things are kept').getByRole('button', { name: 'Save' }));
    expect(api.admin.setRetention).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Remove history past these windows?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.admin.setRetention).toHaveBeenCalledWith({ messageDays: 90, fileDays: null }),
    );
  });

  it('keeps everything again without asking', async () => {
    vi.spyOn(api.admin, 'retention').mockResolvedValue(KEPT_A_YEAR);
    render(<RetentionSection />);
    fireEvent.change(await screen.findByLabelText('Messages'), { target: { value: '' } });
    expect(await screen.findByText('Nothing will be removed.')).toBeTruthy();

    fireEvent.click(card('How long things are kept').getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.admin.setRetention).toHaveBeenCalledWith({ messageDays: null, fileDays: null }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says what the last sweep removed', async () => {
    vi.spyOn(api.admin, 'retention').mockResolvedValue(KEPT_A_YEAR);
    render(<RetentionSection />);
    expect(await screen.findByText(/removed 12 messages and 3 files\./)).toBeTruthy();
  });
});

describe('legal holds', () => {
  it('lists what is held and releases a hold only after a warning', async () => {
    vi.spyOn(api.admin, 'retention').mockResolvedValue(KEPT_A_YEAR);
    render(<RetentionSection />);
    const holds = await screen.findByRole('list', { name: 'On hold' });
    expect(within(holds).getByText('#lawsuit')).toBeTruthy();
    expect(within(holds).getByText('Max')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Release the hold on #lawsuit' }));
    expect(api.admin.holdConversation).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Release the hold on #lawsuit?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Release' }));

    await waitFor(() => expect(api.admin.holdConversation).toHaveBeenCalledWith('c9', false));
  });

  it('places a hold on a person, and offers only what is not held already', async () => {
    vi.spyOn(api.admin, 'retention').mockResolvedValue(KEPT_A_YEAR);
    render(<RetentionSection />);
    const people = (await screen.findByLabelText('Hold a person')) as HTMLSelectElement;
    await waitFor(() => expect(people.options.length).toBe(2));
    expect([...people.options].map((o) => o.textContent)).toEqual(['Choose someone', 'Olga']);
    const conversations = screen.getByLabelText('Hold a conversation') as HTMLSelectElement;
    expect([...conversations.options].map((o) => o.textContent)).toEqual([
      'Choose a channel',
      '#general',
    ]);

    fireEvent.change(people, { target: { value: 'u1' } });
    fireEvent.click(people.closest('.pref-row')!.querySelector('button')!);

    await waitFor(() => expect(api.admin.holdPerson).toHaveBeenCalledWith('u1', true));
  });
});
