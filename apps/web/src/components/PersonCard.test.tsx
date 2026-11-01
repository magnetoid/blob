// @vitest-environment happy-dom
/**
 * The card has to load GET /api/users/{id} when it opens.
 *
 * Bootstrap already has a User, but that row is the directory stub — no timezone,
 * often no fullName. The endpoint exists and had zero product callers.
 *
 * And it is a popover about a person, not a menu: a dialog named for them, with one
 * button in it, that opens from the name the caller draws beside it and goes again on
 * Escape with focus back on that name. The panel is Base UI's popover, from the overlay
 * chunk, which is here before the first test (`src/test/overlayChunk.ts`); a card opened
 * before the chunk lands is `Popover.chunk.test.tsx`'s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { useState } from 'react';
import '../test/overlayChunk.ts';

const getUser = vi.fn();
vi.mock('../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api.ts')>();
  return { ...actual, api: { ...actual.api, users: { ...actual.api.users, get: (...a: unknown[]) => getUser(...a) } } };
});

const { PersonCard } = await import('./PersonCard.tsx');
const { useStore } = await import('../lib/store.ts');

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
function AuthorName() {
  const [open, setOpen] = useState(false);
  return (
    <span className="person-trigger-wrap">
      <button type="button" className="person-trigger" onClick={() => setOpen((v) => !v)}>
        Ana
      </button>
      <PersonCard person={person} open={open} onClose={() => setOpen(false)} />
    </span>
  );
}

describe('PersonCard', () => {
  it('fills full name and timezone from GET /api/users/{id}', async () => {
    render(<PersonCard person={person} open onClose={() => {}} />);
    await waitFor(() => {
      expect(getUser).toHaveBeenCalledWith('u1');
      expect(screen.getByText('Ana Petrović')).toBeTruthy();
      expect(screen.getByText('Europe/Belgrade')).toBeTruthy();
    });
  });

  it('PersonCard opens from its trigger, closes on Escape, returns focus', async () => {
    render(<AuthorName />);
    const trigger = screen.getByRole('button', { name: 'Ana' });
    trigger.focus();

    fireEvent.click(trigger);

    const card = screen.getByRole('dialog', { name: 'Ana' });
    expect(card.textContent).toContain('Message Ana');
    // Focus goes into the card, to the one thing in it that does something.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Message Ana' })),
    );

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

    // Closed at once — inert, for the exit to play off — and gone once that is over.
    expect(card).toHaveProperty('inert', true);
    expect(document.activeElement).toBe(trigger);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('offers a button, not a menu item', () => {
    // A card about somebody is a dialog with a button in it. A lone `menuitem` outside a
    // `menu` is announced as nothing a reader can use.
    render(<PersonCard person={person} open onClose={() => {}} />);

    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('menuitem')).toBeNull();
    expect(screen.getByRole('button', { name: 'Message Ana' })).toBeTruthy();
  });

  it('is drawn beside the name that opened it, and lifts the message row it is in', () => {
    // Every row of the message list is a stacking context (it carries a transform), so a
    // card drawn inside one is painted over by the next row however high its own z-index.
    // `who-somebody-is.css` raises the row while a panel is open in it; this ties the
    // selector that does that to what the card draws, so neither can drift from the other.
    // `import.meta.dirname`: happy-dom's own `URL` would resolve a file URL against its page.
    const css = readFileSync(`${import.meta.dirname}/../styles/app/who-somebody-is.css`, 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const lift = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(
      (rule) => rule[1]!.includes('.message-list-row') && /z-index:\s*var\(--z-popover\)/.test(rule[2]!),
    );
    expect(lift, 'a rule raising the message row').toBeTruthy();
    const selector = lift![1]!.trim();

    // Two rows, one left quiet: happy-dom remembers what `matches` answered for an element
    // and does not forget it when a descendant arrives, so one row asked twice would answer
    // the first time's question again.
    const { container } = render(
      <>
        <div className="message-list-row">
          <AuthorName />
        </div>
        <div className="message-list-row">
          <PersonCard person={person} open={false} onClose={() => {}} />
        </div>
      </>,
    );
    const [row, quiet] = [...container.children];

    fireEvent.click(screen.getByRole('button', { name: 'Ana' }));

    expect(row!.contains(screen.getByRole('dialog', { name: 'Ana' }))).toBe(true);
    expect(row!.matches(selector)).toBe(true);
    // A row with nothing open in it is never raised.
    expect(quiet!.matches(selector)).toBe(false);
  });
});
