// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { trapFocus } from './focusTrap.ts';

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = '';
});

function build(inner: string) {
  document.body.innerHTML = `
    <button id="opener">open</button>
    <button id="behind">behind the dialog</button>
    <div id="dialog">${inner}</div>
  `;
  const opener = document.getElementById('opener') as HTMLButtonElement;
  opener.focus();
  return {
    opener,
    dialog: document.getElementById('dialog') as HTMLElement,
    behind: document.getElementById('behind') as HTMLButtonElement,
  };
}

const tab = (shiftKey = false) =>
  document
    .getElementById('dialog')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }));

/**
 * Every dialog declares aria-modal="true", which promises assistive tech that the rest
 * of the page is inert. The trap is what makes that true, and it had no test at all —
 * a restyle that reorders or reparents a control could have quietly broken it.
 */
describe('trapFocus', () => {
  it('moves focus into the dialog', () => {
    const { dialog } = build('<button id="a">a</button><button id="b">b</button>');

    cleanup = trapFocus(dialog);

    expect(document.activeElement?.id).toBe('a');
  });

  it('leaves focus alone when something inside already has it', () => {
    // An autofocused input must not be overruled by the trap arriving after it.
    const { dialog } = build('<button id="a">a</button><input id="field" />');
    (document.getElementById('field') as HTMLInputElement).focus();

    cleanup = trapFocus(dialog);

    expect(document.activeElement?.id).toBe('field');
  });

  it('wraps from the last control back to the first', () => {
    const { dialog } = build('<button id="a">a</button><button id="b">b</button>');
    cleanup = trapFocus(dialog);
    (document.getElementById('b') as HTMLButtonElement).focus();

    tab();

    expect(document.activeElement?.id).toBe('a');
  });

  it('wraps backwards from the first to the last', () => {
    const { dialog } = build('<button id="a">a</button><button id="b">b</button>');
    cleanup = trapFocus(dialog);

    tab(true);

    expect(document.activeElement?.id).toBe('b');
  });

  it('never lands on a control behind the dialog', () => {
    const { dialog, behind } = build('<button id="a">a</button><button id="b">b</button>');
    cleanup = trapFocus(dialog);

    tab();
    tab();
    tab();

    expect(document.activeElement).not.toBe(behind);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('skips a disabled control rather than stranding Tab on it', () => {
    const { dialog } = build(
      '<button id="a">a</button><button id="off" disabled>off</button><button id="b">b</button>',
    );
    cleanup = trapFocus(dialog);
    (document.getElementById('b') as HTMLButtonElement).focus();

    tab();

    expect(document.activeElement?.id).toBe('a');
  });

  it('gives focus back to whatever opened it', () => {
    const { dialog, opener } = build('<button id="a">a</button>');
    const release = trapFocus(dialog);

    release();

    expect(document.activeElement).toBe(opener);
  });

  it('does nothing, safely, when there is no node', () => {
    // Called from an effect against a ref that may not be attached yet.
    expect(() => trapFocus(null)()).not.toThrow();
  });
});
