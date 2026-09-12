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

  it('closes on cancel', () => {
    const { onClose, onConfirm } = renderDialog();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on the backdrop and not on the panel', () => {
    const { onClose } = renderDialog();
    // The panel is the `.dialog` element; the host `<dialog>` around it is the backdrop.
    fireEvent.click(document.querySelector('.dialog') as Element);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('colours a destructive answer differently', () => {
    renderDialog({ danger: true, confirmLabel: 'Delete' });
    expect(screen.getByText('Delete').className).toContain('btn-danger');
  });
});
