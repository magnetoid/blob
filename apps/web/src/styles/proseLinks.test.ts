// @vitest-environment happy-dom

/**
 * A link in a message has to look like one.
 *
 * Blob's link colour is `--blob-accent`, which is shadcn's `--primary` now: near-black in
 * light and near-white in dark, 1.1:1 and 1.2:1 against the text around it. Colour no
 * longer says "link", so an underline does — shadcn's own typography draws a link
 * `underline underline-offset-4`. `lib/markdown.tsx` emits bare `<a>` elements, so the
 * rule is keyed on every container `renderMarkdown` and `renderInline` draw into, and not
 * on `a`: a bare `a { text-decoration: underline }` would underline every row, card and
 * menu item that happens to be an anchor.
 *
 * Read as text, as `theme.test.ts` does: happy-dom resolves no cascade.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../lib/markdown.tsx';

// happy-dom gives `import.meta.url` no file path; vitest runs from `apps/web`.
const SRC = resolve(process.cwd(), 'src');

/** Where each caller of the markdown renderer puts what it returns, and in which file. */
const PROSE_CONTAINERS: Record<string, string[]> = {
  'features/messages/MessageRow.tsx': ['message-body'],
  'features/messages/FilePreviewPanel.tsx': ['message-body'],
  'features/messages/PinnedPanel.tsx': ['pinned-item-body'],
  'features/messages/MessageResultRow.tsx': ['search-result-text'],
  'features/messages/BlockRenderer.tsx': ['block-section', 'block-fields', 'block-context'],
  'features/messages/ThreadSummary.tsx': ['summary-overview', 'agentic-list'],
  'features/work/WorkPreview.tsx': ['work-document'],
};

function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter(
    (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
  );
}

/** Every `selector { declarations }` in the legacy CSS, comments removed. */
function legacyRules(): { prelude: string; body: string }[] {
  const files = [
    join(SRC, 'styles/app.css'),
    ...readdirSync(join(SRC, 'styles/app'), { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.css'))
      .map((file) => join(SRC, 'styles/app', file)),
  ];
  const rules: { prelude: string; body: string }[] = [];
  for (const file of files) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      rules.push({
        prelude: match[1]!.replace(/\s+/g, ' ').trim(),
        body: match[2]!.replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return rules;
}

describe('links in prose', () => {
  it('are underlined, in every container the markdown renderer draws into', () => {
    const underlined = legacyRules().filter(
      ({ prelude, body }) =>
        /(?:^|[;\s])text-decoration:\s*underline\b/.test(body) &&
        /(?:^|[;\s])text-underline-offset:\s*4px\b/.test(body) &&
        // A descendant `a`, hover or not.
        /\sa(?::[\w-]+)*$/.test(prelude),
    );
    expect(underlined, 'a rule that underlines links under prose').not.toHaveLength(0);
    const prelude = underlined.map((rule) => rule.prelude).join(' | ');
    const containers = Object.values(PROSE_CONTAINERS).flat();
    for (const container of new Set(containers)) {
      expect(prelude, `.${container} a`).toMatch(new RegExp(`\\.${container}(?![\\w-])`));
    }
  });

  it('are not every anchor in the app: a bare `a` stays plain', () => {
    const bare = legacyRules().filter(({ prelude }) => prelude === 'a');
    expect(bare).toHaveLength(1);
    expect(bare[0]!.body).toMatch(/text-decoration:\s*none/);
    // And no rule widens the underline to anchors in general.
    const wide = legacyRules().filter(
      ({ prelude, body }) =>
        /^a(?::[\w-]+)*$/.test(prelude) &&
        /text-underline-offset:\s*4px/.test(body) &&
        !/:hover/.test(prelude),
    );
    expect(wide.map((rule) => rule.prelude)).toEqual([]);
  });

  it('have a container for every caller of the renderer, and no caller is missing', () => {
    const callers = sourceFiles()
      .filter((file) => file !== 'lib/markdown.tsx')
      .filter((file) =>
        /from ['"](?:\.\.?\/)+lib\/markdown\.tsx['"]/.test(readFileSync(join(SRC, file), 'utf8')),
      )
      .map((file) => relative('.', file))
      .sort();
    expect(callers, 'a new caller of lib/markdown.tsx needs its container listed here').toEqual(
      Object.keys(PROSE_CONTAINERS).sort(),
    );
    for (const [file, containers] of Object.entries(PROSE_CONTAINERS)) {
      const source = readFileSync(join(SRC, file), 'utf8');
      for (const container of containers) {
        expect(source, `${file} draws into .${container}`).toMatch(
          new RegExp(`className=["'{\`][^"'\`]*(?<![\\w-])${container}(?![\\w-])`),
        );
      }
    }
  });

  it('reach the anchor the renderer emits, and nothing else', () => {
    const rule = legacyRules().find(
      ({ prelude, body }) => /text-underline-offset:\s*4px/.test(body) && /\sa$/.test(prelude),
    );
    expect(rule, 'the prose link rule').toBeDefined();
    const markup = renderToStaticMarkup(
      renderMarkdown('see [the docs](https://example.com/docs) or https://example.com', {
        knownNames: new Map(),
        currentUserId: null,
        customEmoji: [],
      }) as never,
    );
    for (const container of new Set(Object.values(PROSE_CONTAINERS).flat())) {
      document.body.innerHTML = `<div class="${container}">${markup}</div>`;
      const links = document.body.querySelectorAll(rule!.prelude);
      expect(links.length, `.${container} links the rule reaches`).toBe(2);
    }
    // An anchor that is a row or a card, outside any prose container, is not reached.
    document.body.innerHTML = '<nav><a class="sidebar-row" href="/c/1">general</a></nav>';
    expect(document.body.querySelectorAll(rule!.prelude)).toHaveLength(0);
  });
});
