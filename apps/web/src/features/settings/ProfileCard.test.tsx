// @vitest-environment happy-dom
/** Settings → Profile: the parts of you other people see. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_PREFS } from '@blob/shared';

const uploadFile = vi.fn();
vi.mock('../../lib/attachments.ts', () => ({ uploadFile: (...args: unknown[]) => uploadFile(...args) }));

const { ProfileCard } = await import('./ProfileCard.tsx');
const { useStore } = await import('../../lib/store.ts');
const { api } = await import('../../lib/api.ts');

const ANA = {
  id: 'me',
  displayName: 'Ana',
  fullName: null,
  title: null,
  statusEmoji: null,
  statusText: null,
  statusExpiresAt: null,
  avatarUrl: null,
  kind: 'human',
  prefs: { ...DEFAULT_PREFS },
};

beforeEach(() => {
  useStore.setState({ currentUser: ANA as never });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  uploadFile.mockReset();
});

const saveButton = () => screen.getByRole<HTMLButtonElement>('button', { name: /^(Save|Saving…)$/ });

describe('saving your profile', () => {
  it('saves only once something has changed, sending an emptied field as null', async () => {
    const update = vi
      .spyOn(api.me, 'update')
      .mockResolvedValue({ user: { ...ANA, displayName: 'Ana B' } } as never);
    render(<ProfileCard />);
    expect(saveButton().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: ' Ana B ' } });
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        displayName: 'Ana B',
        fullName: null,
        title: null,
        statusEmoji: null,
        statusText: null,
        statusExpiresAt: null,
      }),
    );
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(useStore.getState().currentUser?.displayName).toBe('Ana B');
  });

  it('will not save a blank display name', () => {
    render(<ProfileCard />);
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: '   ' } });
    expect(saveButton().disabled).toBe(true);
  });

  it('says why when the server refuses, beside the form', async () => {
    vi.spyOn(api.me, 'update').mockRejectedValue(new Error('That name is taken.'));
    render(<ProfileCard />);
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Bo' } });
    fireEvent.click(saveButton());
    expect((await screen.findByRole('alert')).textContent).toBe('That name is taken.');
  });
});

describe('the display name', () => {
  it('says what it is for as its description, not only beside it', () => {
    render(<ProfileCard />);
    expect(
      screen.getByRole('textbox', {
        name: 'Display name',
        description: 'This is the name on your messages and mentions.',
      }),
    ).toBeTruthy();
  });
});

describe('your status', () => {
  it('offers "Clear after" only once there is a status to clear', () => {
    render(<ProfileCard />);
    expect(screen.queryByLabelText('Clear after')).toBeNull();

    fireEvent.change(screen.getByLabelText('Status text'), { target: { value: 'Heads down' } });
    expect(screen.getByLabelText('Clear after')).toBeTruthy();
  });

  it('shows the name and the status as others will read them', () => {
    render(<ProfileCard />);
    expect(screen.getByText('No status set')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Status emoji'), { target: { value: '🎧' } });
    fireEvent.change(screen.getByLabelText('Status text'), { target: { value: 'Heads down' } });
    expect(screen.getByText('🎧 Heads down')).toBeTruthy();
  });
});

describe('your photo', () => {
  it('uploads the picture chosen and attaches it to you', async () => {
    uploadFile.mockResolvedValue('att-1');
    const update = vi
      .spyOn(api.me, 'update')
      .mockResolvedValue({ user: { ...ANA, avatarUrl: '/a.png' } } as never);
    render(<ProfileCard />);

    const file = new File(['x'], 'me.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Choose a profile photo'), { target: { files: [file] } });

    await waitFor(() => expect(update).toHaveBeenCalledWith({ avatarAttachmentId: 'att-1' }));
    expect(uploadFile).toHaveBeenCalledWith(file, 'image/png');
    // Now there is one, the button says change, and Remove is offered.
    expect(await screen.findByRole('button', { name: 'Change photo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('removes it again', async () => {
    useStore.setState({ currentUser: { ...ANA, avatarUrl: '/a.png' } as never });
    const update = vi.spyOn(api.me, 'update').mockResolvedValue({ user: ANA } as never);
    render(<ProfileCard />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ avatarAttachmentId: null }));
    expect(await screen.findByRole('button', { name: 'Add a photo' })).toBeTruthy();
  });
});
