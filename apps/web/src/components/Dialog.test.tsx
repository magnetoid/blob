// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Dialog } from './Dialog.tsx';

afterEach(cleanup);

function renderDialog(onClose = vi.fn()) {
  render(
    <Dialog label="Archive #general?" onClose={onClose}>
      <div className="dialog">
        <p>It stays searchable.</p>
        <button type="button">Archive</button>
      </div>
    </Dialog>,
  );
  return onClose;
}

describe('Dialog', () => {
  it('is a modal dialog with the name it was given', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Archive #general?' }) as HTMLDialogElement;
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog.open).toBe(true);
  });

  it('closes on Escape, through the stack every overlay shares', () => {
    const onClose = renderDialog();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a click that lands on the backdrop, and not on one inside', () => {
    const onClose = renderDialog();
    fireEvent.click(screen.getByText('It stays searchable.'));
    expect(onClose).not.toHaveBeenCalled();
    // Clicks on `::backdrop` are delivered to the dialog element itself; the content
    // wrapper fills the element, so a click whose target is the element is on the backdrop.
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes once, however many ways it was asked', () => {
    const onClose = renderDialog();
    fireEvent.click(screen.getByRole('dialog'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('puts focus back where it came from', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = render(
      <Dialog label="A question" onClose={() => {}}>
        <div className="dialog">
          <button type="button">Yes</button>
        </div>
      </Dialog>,
    );
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
