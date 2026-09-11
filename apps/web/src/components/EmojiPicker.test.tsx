// @vitest-environment happy-dom
/**
 * Skin tones live on the picker, not on the catalog.
 *
 * Hands take a Fitzpatrick modifier; party poppers do not. The bar remembers the last
 * tone so the next 👍 is the same colour as the last, and a custom emoji is never
 * rewritten — it is an image, not a character.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useStore } from '../lib/store.ts';
import { EmojiPicker } from './EmojiPicker.tsx';

afterEach(cleanup);

beforeEach(() => {
  useStore.setState({ customEmoji: [] });
  window.localStorage?.clear?.();
});

describe('skin tones in the picker', () => {
  it('applies the chosen tone when a hand is picked', () => {
    const onPick = vi.fn();
    render(
      <EmojiPicker onPick={onPick} onClose={() => undefined} label="Insert an emoji" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Medium' }));
    fireEvent.click(screen.getByRole('button', { name: ':thumbsup:' }));

    expect(onPick).toHaveBeenCalledWith('👍🏽');
  });

  it('does not tone an emoji that cannot take a modifier', () => {
    const onPick = vi.fn();
    render(
      <EmojiPicker onPick={onPick} onClose={() => undefined} label="Insert an emoji" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    fireEvent.click(screen.getByRole('button', { name: ':tada:' }));

    expect(onPick).toHaveBeenCalledWith('🎉');
  });
});
