// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog.tsx';

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
    expect(screen.getByText('Archive #general?')).toBeTruthy();
    expect(screen.getByText('It stays searchable.')).toBeTruthy();
    // Named after the verb, not "OK" — the whole reason this replaced window.confirm.
    expect(screen.getByText('Archive')).toBeTruthy();
  });

  it('confirms once', () => {
    const { onConfirm, onClose } = renderDialog();
    fireEvent.click(screen.getByText('Archive'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on cancel, on the backdrop, and on Escape', () => {
    const { onClose, onConfirm } = renderDialog();
    fireEvent.click(screen.getByText('Cancel'));
    fireEvent.click(document.querySelector('.dialog-backdrop') as Element);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('does not close when the dialog itself is clicked', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('colours a destructive answer differently', () => {
    renderDialog({ danger: true, confirmLabel: 'Delete' });
    expect(screen.getByText('Delete').className).toContain('btn-danger');
  });
});
