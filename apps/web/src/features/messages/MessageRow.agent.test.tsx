// @vitest-environment happy-dom
/**
 * Telling an agent's message from a person's, at a glance.
 *
 * ADR 0005 makes a bot a real `users` row so that mentions, search and DMs work with no
 * frontend change — which is exactly what makes this necessary. A bot posts through the
 * same path a person does and lands in the list looking like one, and "who wrote this"
 * is the first thing a reader needs, not the last. The Meadow direction answers it with
 * a reserved iris colour and a badge rather than an icon, because a word survives being
 * small, colour-blind, and printed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Avatar } from '../../components/Avatar.tsx';

afterEach(cleanup);

describe('an agent is marked as one', () => {
  it('marks a bot avatar and leaves a person alone', () => {
    const { container } = render(
      <Avatar user={{ displayName: 'Scout', avatarUrl: null, kind: 'bot' }} />,
    );
    expect(container.querySelector('.avatar')?.getAttribute('data-kind')).toBe('bot');

    cleanup();
    const person = render(
      <Avatar user={{ displayName: 'Marko', avatarUrl: null, kind: 'human' }} />,
    );
    expect(person.container.querySelector('.avatar')?.getAttribute('data-kind')).toBe('human');
  });

  it('leaves the kind off when the caller does not know it', () => {
    // Most callers pass a partial user. They must keep working, and must not claim the
    // person is human when nobody said so.
    const { container } = render(<Avatar user={{ displayName: 'Ana', avatarUrl: null }} />);
    expect(container.querySelector('.avatar')?.hasAttribute('data-kind')).toBe(false);
    expect(screen.getByTitle('Ana')).toBeTruthy();
  });
});
