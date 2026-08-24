// @vitest-environment happy-dom
/**
 * Shortcode rendering, and the three ways it could quietly go wrong.
 *
 * The security property is the one worth pinning: an `<img>` appears only when the name
 * in the body matches something the workspace uploaded. A body supplies a *name*, never a
 * URL, so no message can point an image tag somewhere of its own choosing. The test for
 * an unknown name is that property stated from the other side.
 *
 * The rest guard the inline parser's "earliest match wins" rule, which is what keeps a
 * colon inside a URL from being read as the start of a shortcode.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { CustomEmoji } from '@blob/shared';
import { renderMarkdown, type RenderOptions } from './markdown.tsx';

afterEach(cleanup);

const shipit: CustomEmoji = { name: 'shipit', url: 'https://files.test/shipit.png' };

function options(customEmoji: CustomEmoji[] = []): RenderOptions {
  return { knownNames: new Map(), currentUserId: null, customEmoji };
}

function draw(body: string, customEmoji: CustomEmoji[] = []) {
  return render(<div>{renderMarkdown(body, options(customEmoji))}</div>).container;
}

describe('custom emoji in a message body', () => {
  it('turns a built-in shortcode into its character', () => {
    const el = draw('ship it :tada:');
    expect(el.textContent).toContain('🎉');
    expect(el.querySelector('img')).toBeNull();
  });

  it("renders a workspace's own emoji as an image", () => {
    const img = draw('ship it :shipit:', [shipit]).querySelector('img');
    expect(img?.getAttribute('src')).toBe(shipit.url);
    expect(img?.getAttribute('alt')).toBe(':shipit:');
  });

  it('leaves an unknown name as the text that was typed', () => {
    const el = draw('this is :not_an_emoji: really', [shipit]);
    expect(el.textContent).toContain(':not_an_emoji:');
    expect(el.querySelector('img')).toBeNull();
  });

  it('renders nothing as an image once the emoji is deleted', () => {
    // Same body as the passing case above, with an empty workspace list.
    const el = draw('ship it :shipit:', []);
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain(':shipit:');
  });

  it('does not convert a shortcode inside code', () => {
    const el = draw('use `:tada:` to celebrate');
    expect(el.querySelector('code')?.textContent).toBe(':tada:');
    expect(el.textContent).not.toContain('🎉');
  });

  it('leaves a colon inside a URL alone', () => {
    const el = draw('see http://example.com/a:b: now');
    expect(el.querySelector('a')?.getAttribute('href')).toContain('example.com/a:b');
    expect(el.querySelector('img')).toBeNull();
  });

  it('still renders a shortcode that follows a link', () => {
    const el = draw('http://example.com :tada:');
    expect(el.querySelector('a')).not.toBeNull();
    expect(el.textContent).toContain('🎉');
  });
});
