// @vitest-environment happy-dom
/** A value shown once, with its Copy: an invitation link, a webhook's secret, a callback
 * URL. What these pin is that Copy puts the value on the clipboard and says so where a
 * screen reader will hear it, and that the field has a name of its own. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CopyField } from './CopyField.tsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function clipboard(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

describe('a copy field', () => {
  it('copies the value and says so', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    clipboard(writeText);
    render(<CopyField value="https://blob.example/join/abc" label="Invitation link" />);

    const status = screen.getByRole('status');
    // There before anything is said in it, so the words are announced when they arrive.
    expect(status.textContent).toBe('');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(writeText).toHaveBeenCalledWith('https://blob.example/join/abc');
    expect(status.textContent).toBe('Copied');

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(status.textContent).toBe('');
  });

  it('labels the field for a screen reader', () => {
    render(<CopyField value="whsec_123" label="Signing secret" copiedNote="Secret copied" />);
    const field = screen.getByRole('textbox', { name: 'Signing secret' }) as HTMLInputElement;
    expect(field.value).toBe('whsec_123');
    // Shown to be copied, not edited.
    expect(field.readOnly).toBe(true);
  });

  // A page reached over plain http on a local network has no clipboard. The value is on
  // screen, so the field selects it for copying by hand rather than claiming a copy.
  it('selects the value when the browser will not copy it', async () => {
    clipboard(() => Promise.reject(new Error('not allowed')));
    render(<CopyField value="whsec_123" label="Signing secret" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    const field = screen.getByRole('textbox', { name: 'Signing secret' }) as HTMLInputElement;
    expect(screen.getByRole('status').textContent).toBe('');
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 'whsec_123'.length]);
  });
});
