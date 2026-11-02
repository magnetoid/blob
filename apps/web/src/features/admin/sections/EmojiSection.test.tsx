// @vitest-environment happy-dom
/** The workspace's own emoji. What these pin is the order of the two calls an add makes
 * (the image has to exist before it can be named), that the name sent is the cleaned
 * one, and that the form says what a name may be as the hint of the field that is wrong. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { uploadFile } = vi.hoisted(() => ({
  uploadFile: vi.fn<(file: File, mime: string) => Promise<string>>(async () => 'att-1'),
}));
vi.mock('../../../lib/attachments.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/attachments.ts')>()),
  uploadFile,
}));

await import('../../../test/overlayChunk.ts');
const { api } = await import('../../../lib/api.ts');
const { EmojiSection } = await import('./EmojiSection.tsx');

const PARROT = {
  name: 'party-parrot',
  url: '/api/emoji/party-parrot',
  createdByName: 'Olga',
  createdAt: '2026-10-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.restoreAllMocks();
  uploadFile.mockClear();
  vi.spyOn(api.admin, 'customEmoji').mockResolvedValue({ emoji: [PARROT] });
});

afterEach(cleanup);

function png() {
  return new File(['x'], 'parrot.png', { type: 'image/png' });
}

describe('adding an emoji', () => {
  it('holds Add until there is a name that will be accepted and an image', async () => {
    render(<EmojiSection onError={vi.fn()} />);
    await screen.findByRole('table', { name: 'Custom emoji' });
    const add = screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'dance' } });
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Image'), { target: { files: [png()] } });
    expect(add.disabled).toBe(false);
  });

  it('uploads the image, then names it with the colons and capitals taken off', async () => {
    const named = vi.spyOn(api.admin, 'addCustomEmoji').mockResolvedValue({ emoji: PARROT } as never);
    render(<EmojiSection onError={vi.fn()} />);
    await screen.findByRole('table', { name: 'Custom emoji' });

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: ':Dance:' } });
    fireEvent.change(screen.getByLabelText('Image'), { target: { files: [png()] } });
    // What a person will type to use it, as they typed it.
    expect(screen.getByText(':dance:')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(named).toHaveBeenCalledWith('dance', 'att-1'));
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(uploadFile.mock.calls[0]![1]).toBe('image/png');
    // The form is empty again for the next one.
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(''));
  });

  it('says what a name may be as the hint of the field that is wrong', async () => {
    render(<EmojiSection onError={vi.fn()} />);
    await screen.findByRole('table', { name: 'Custom emoji' });
    const name = screen.getByRole('textbox', { name: 'Name' });
    expect(name.getAttribute('aria-invalid')).toBeNull();

    fireEvent.change(name, { target: { value: 'x' } });
    expect(
      screen.getByRole('textbox', {
        name: 'Name',
        description: /Two to thirty-two characters: lowercase letters, numbers, underscore, plus and hyphen/,
      }),
    ).toBeTruthy();
    expect(name.getAttribute('aria-invalid')).toBe('true');
  });

  it('reports a refusal, and leaves what was typed', async () => {
    const { ApiError } = await import('../../../lib/api.ts');
    vi.spyOn(api.admin, 'addCustomEmoji').mockRejectedValue(new ApiError(409, 'conflict', 'That name is taken.'));
    const onError = vi.fn();
    render(<EmojiSection onError={onError} />);
    await screen.findByRole('table', { name: 'Custom emoji' });

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'dance' } });
    fireEvent.change(screen.getByLabelText('Image'), { target: { files: [png()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith('That name is taken.'));
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('dance');
  });
});

describe('the emoji already there', () => {
  it('are a table: the picture, its name, who added it, and a Remove that names it', async () => {
    render(<EmojiSection onError={vi.fn()} />);
    const table = await screen.findByRole('table', { name: 'Custom emoji' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Image',
      'Name',
      'Added by',
      'Actions',
    ]);
    const row = within(table).getByRole('row', { name: /:party-parrot:/ });
    expect(within(row).getByText('Olga')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Remove :party-parrot:' })).toBeTruthy();
    // A picture beside its name does not need to be read twice.
    expect(row.querySelector('img')!.getAttribute('alt')).toBe('');
  });

  it('say so when there are none', async () => {
    vi.spyOn(api.admin, 'customEmoji').mockResolvedValue({ emoji: [] });
    render(<EmojiSection onError={vi.fn()} />);
    expect(await screen.findByText('None yet.')).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Custom emoji' })).toBeNull();
  });

  it('are removed only after asking, by name', async () => {
    const remove = vi.spyOn(api.admin, 'removeCustomEmoji').mockResolvedValue({ ok: true } as never);
    render(<EmojiSection onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove :party-parrot:' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Remove :party-parrot:?' });
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('party-parrot'));
  });
});
