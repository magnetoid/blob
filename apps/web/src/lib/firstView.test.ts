// @vitest-environment happy-dom
/**
 * What ends the first view: a pushed route, the browser's Back, or anything done on the
 * page. Each test takes a fresh copy of the module, because leaving is one-way for the
 * life of a page, as it is for the module.
 */
import { describe, expect, it, vi } from 'vitest';

async function fresh() {
  vi.resetModules();
  return import('./firstView.ts');
}

describe('the first view', () => {
  it('is where the app starts', async () => {
    const { onFirstView } = await fresh();
    expect(onFirstView()).toBe(true);
  });

  it('is left by a press anywhere on the page — a tab, a filter, a toggle', async () => {
    const { onFirstView } = await fresh();
    window.dispatchEvent(new Event('pointerdown'));
    expect(onFirstView()).toBe(false);
  });

  it('is left by a key', async () => {
    const { onFirstView } = await fresh();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    expect(onFirstView()).toBe(false);
  });

  it('is not left by the popstate the router sends itself', async () => {
    // Every navigation dispatches one, pushed or replaced; only the browser's own —
    // Back, Forward — is trusted, and the router says for itself when it pushed.
    const { onFirstView } = await fresh();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(onFirstView()).toBe(true);
  });
});
