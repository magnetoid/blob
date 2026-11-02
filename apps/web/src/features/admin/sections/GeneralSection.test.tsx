// @vitest-environment happy-dom
/** What this server is called, and who may broadcast in it. What these pin is that each
 * setting is one card whose title is its field's label (so a click on the words puts the
 * cursor in the field) and whose line under it is the field's hint, and that a name is
 * saved trimmed and told to the top bar. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '../../../lib/api.ts';
import { useStore } from '../../../lib/store.ts';
import { GeneralSection } from './GeneralSection.tsx';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api.admin, 'settings').mockResolvedValue({
    name: 'Acme',
    slug: 'acme',
    settings: { everyoneMentions: 'everyone' },
  });
});

afterEach(cleanup);

describe('the server’s name', () => {
  it('is a field named by its card’s title, and described by the line under it', async () => {
    render(<GeneralSection onError={vi.fn()} />);
    const field = (await screen.findByRole('textbox', {
      name: 'Server name',
      description: 'Shown in the top bar, on the sign-in screen, and in invitations.',
    })) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe('Acme'));
    expect(screen.getByRole('heading', { level: 2, name: 'Server name' })).toBeTruthy();
  });

  it('is saved without the spaces round it, and told to the top bar', async () => {
    const update = vi
      .spyOn(api.admin, 'updateSettings')
      .mockResolvedValue({ name: 'Acme Inc', slug: 'acme', settings: {} });
    render(<GeneralSection onError={vi.fn()} />);
    const field = await screen.findByRole('textbox', { name: 'Server name' });
    await waitFor(() => expect((field as HTMLInputElement).value).toBe('Acme'));

    fireEvent.change(field, { target: { value: '  Acme Inc ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith({ name: 'Acme Inc' }));
    await waitFor(() => expect(useStore.getState().workspaceName).toBe('Acme Inc'));
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeTruthy();
  });

  it('is saved by Enter in the field, as a form is', async () => {
    const update = vi
      .spyOn(api.admin, 'updateSettings')
      .mockResolvedValue({ name: 'Beta', slug: 'acme', settings: {} });
    render(<GeneralSection onError={vi.fn()} />);
    const field = await screen.findByRole('textbox', { name: 'Server name' });
    await waitFor(() => expect((field as HTMLInputElement).value).toBe('Acme'));

    fireEvent.change(field, { target: { value: 'Beta' } });
    fireEvent.submit(field.closest('form')!);
    await waitFor(() => expect(update).toHaveBeenCalledWith({ name: 'Beta' }));
  });
});

describe('who may notify a whole channel', () => {
  it('is a choice named by its card’s title, and described by its hint', async () => {
    render(<GeneralSection onError={vi.fn()} />);
    const choice = (await screen.findByRole('combobox', {
      name: '@channel, @here and @everyone',
      description: /Who may notify a whole channel at once/,
    })) as HTMLSelectElement;
    await waitFor(() => expect(choice.value).toBe('everyone'));
    expect(Array.from(choice.options).map((o) => o.text)).toEqual(['Everyone', 'Admins only']);
  });

  it('is saved as it is chosen, and the store hears of it', async () => {
    const update = vi
      .spyOn(api.admin, 'updateSettings')
      .mockResolvedValue({ name: 'Acme', slug: 'acme', settings: { everyoneMentions: 'admins' } });
    render(<GeneralSection onError={vi.fn()} />);
    const choice = await screen.findByRole('combobox', { name: '@channel, @here and @everyone' });

    fireEvent.change(choice, { target: { value: 'admins' } });
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ settings: { everyoneMentions: 'admins' } }),
    );
    await waitFor(() => expect(useStore.getState().everyoneMentions).toBe('admins'));
  });
});
