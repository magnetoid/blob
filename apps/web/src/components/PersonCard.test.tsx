// @vitest-environment happy-dom
/**
 * The card has to load GET /api/users/{id} when it opens.
 *
 * Bootstrap already has a User, but that row is the directory stub — no timezone,
 * often no fullName. The endpoint exists and had zero product callers.
 *
 * And it is a popover about a person, not a menu: a dialog named for them, with one
 * button in it, that opens from the name the caller draws beside it and goes again on
 * Escape with focus back on that name. The card is shadcn's Popover (Base UI's), a module of
 * its own (`features/messages/lazyPopups.ts`) drawn only once the name is pressed; the
 * overlay chunk is here before the first test (`src/test/overlayChunk.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../test/overlayChunk.ts';

const getUser = vi.fn();
vi.mock('../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api.ts')>();
  return { ...actual, api: { ...actual.api, users: { ...actual.api.users, get: (...a: unknown[]) => getUser(...a) } } };
});

const showChannel = vi.fn(async () => {});
vi.mock('../lib/navigation.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/navigation.ts')>()),
  showChannel: (...a: unknown[]) => (showChannel as (...a: unknown[]) => unknown)(...a),
}));

const { PersonCardPopup } = await import('../features/messages/lazyPopups.ts');
const { useEscape } = await import('../lib/useEscape.ts');
const { useStore } = await import('../lib/store.ts');
const { api } = await import('../lib/api.ts');

await PersonCardPopup.preload();

afterEach(cleanup);

const person = {
  id: 'u1',
  kind: 'human' as const,
  displayName: 'Ana',
  fullName: null,
  title: 'Editor',
  avatarUrl: null,
  timezone: 'UTC',
  role: 'member' as const,
  statusEmoji: null,
  statusText: null,
  statusExpiresAt: null,
  deactivated: false,
  agentDisabled: false,
  agentResident: false,
  placeholder: false,
};

beforeEach(() => {
  getUser.mockReset();
  getUser.mockResolvedValue({
    user: { ...person, fullName: 'Ana Petrović', timezone: 'Europe/Belgrade' },
  });
  useStore.setState({
    currentUser: { id: 'me', displayName: 'Me' },
    users: { u1: person },
  } as never);
});

/** The author's name and its card, as `MessageRow` draws them. */
function authorName() {
  return render(
    <article tabIndex={-1}>
      <PersonCardPopup
        person={person}
        trigger={
          <button type="button" className="person-trigger">
            Ana
          </button>
        }
      />
    </article>,
  );
}

const name = () => screen.getByRole('button', { name: 'Ana' });

describe('the person card', () => {
  it('draws no card root until the name is pressed', async () => {
    // The module is here, and still a row costs no Base UI root until somebody presses the
    // name: a virtualised list mounts rows on every scroll, and most names are never pressed.
    const { container } = authorName();
    expect(container.querySelector('[data-slot="popover-trigger"]')).toBeNull();
    expect(name().getAttribute('aria-haspopup')).toBe('dialog');
    expect(getUser).not.toHaveBeenCalled();

    fireEvent.click(name());

    expect(await screen.findByRole('dialog', { name: 'Ana' })).toBeTruthy();
    expect(container.querySelector('[data-slot="popover-trigger"]')).toBe(name());
  });

  it('opens the author’s card from their name, named for them', async () => {
    authorName();
    fireEvent.click(name());

    const card = await screen.findByRole('dialog', { name: 'Ana' });
    expect(card.textContent).toContain('Message Ana');
    expect(name().getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => {
      expect(getUser).toHaveBeenCalledWith('u1');
      expect(screen.getByText('Ana Petrović')).toBeTruthy();
      expect(screen.getByText('Europe/Belgrade')).toBeTruthy();
    });
    // Focus goes into the card, to the one thing in it that does something.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Message Ana' })),
    );
  });

  it('closes on Escape and gives focus back to the name', async () => {
    authorName();
    name().focus();
    fireEvent.click(name());
    await screen.findByRole('dialog', { name: 'Ana' });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Message Ana' })),
    );

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(name()));
  });

  it('takes one Escape beside an open panel: the card closes and the panel stays', async () => {
    // A panel behind the card is a layer on the stack that was there first.
    const closePanel = vi.fn();
    function Panel() {
      useEscape(closePanel);
      return null;
    }
    render(<Panel />);
    authorName();
    fireEvent.click(name());
    await screen.findByRole('dialog', { name: 'Ana' });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Message Ana' })),
    );

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(closePanel).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(closePanel).toHaveBeenCalledTimes(1);
  });

  it('offers a button, not a menu item', async () => {
    // A card about somebody is a dialog with a button in it. A lone `menuitem` outside a
    // `menu` is announced as nothing a reader can use.
    authorName();
    fireEvent.click(name());
    await screen.findByRole('dialog', { name: 'Ana' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('menuitem')).toBeNull();
    expect(screen.getByRole('button', { name: 'Message Ana' })).toBeTruthy();
  });

  it('opens a conversation with them, and closes', async () => {
    const open = vi.spyOn(api.dms, 'open').mockResolvedValue({ channel: { id: 'dm1' } } as never);
    authorName();
    fireEvent.click(name());

    fireEvent.click(await screen.findByRole('button', { name: 'Message Ana' }));

    await waitFor(() => expect(open).toHaveBeenCalledWith(['u1']));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(showChannel).toHaveBeenCalledWith('dm1');
    expect(useStore.getState().channels['dm1']).toBeTruthy();
    open.mockRestore();
  });
});
