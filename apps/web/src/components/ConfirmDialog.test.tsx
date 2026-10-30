// @vitest-environment happy-dom
/**
 * Are you sure? — shadcn's alert dialog, in the words the caller chose.
 *
 * The overlay chunk is already here (`src/test/setup.ts`), so the question is drawn in the
 * render that asked it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import '../test/overlayChunk.ts';

afterEach(cleanup);

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <ConfirmDialog
      title="Archive #general?"
      body="It stays searchable."
      confirmLabel="Archive"
      onConfirm={onConfirm}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onConfirm, onClose };
}

describe('the confirm dialog', () => {
  it('asks in the words it was given', () => {
    renderDialog();
    const question = screen.getByRole('alertdialog', { name: 'Archive #general?' });
    expect(question.textContent).toContain('It stays searchable.');
    // Named after the verb, not "OK" — the whole reason this replaced window.confirm.
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy();
  });

  it('confirms once', () => {
    const { onConfirm, onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on cancel', () => {
    const { onClose, onConfirm } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('colours a destructive answer differently', () => {
    renderDialog({ danger: true, confirmLabel: 'Delete' });
    const destroy = screen.getByRole('button', { name: 'Delete' });
    expect(destroy.className).toContain('text-destructive');
    cleanup();

    renderDialog({ confirmLabel: 'Archive' });
    const plain = screen.getByRole('button', { name: 'Archive' });
    expect(plain.className).not.toContain('text-destructive');
    expect(plain.className).toContain('bg-primary');
  });

  it('takes focus itself rather than handing it to the answer', async () => {
    // Focusing the confirm button would make Return destroy something one keystroke after
    // the question appeared under somebody's hands.
    renderDialog({ danger: true, confirmLabel: 'Delete' });
    const question = screen.getByRole('alertdialog');
    await waitFor(() => expect(document.activeElement).toBe(question));
  });

  it('is not dismissed by a click beside it', () => {
    // An alert dialog asks; it is answered with a button or Escape, not by a stray click on
    // the page around it.
    const { onClose, onConfirm } = renderDialog();
    fireEvent.click(document.querySelector('[data-slot="dialog-overlay"]')!);
    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
