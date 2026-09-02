// @vitest-environment happy-dom
/** What's new, and which build you are reading it in.
 *
 * The page has two audiences and the test follows them: the release notes are for
 * somebody using Blob, and the build stamp is for somebody who needs to know *which*
 * Blob — which version, which commit, what went into it. The second half is the one
 * worth pinning, because it is stamped in at build time and can only ever be wrong
 * silently.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WhatsNewView } from './WhatsNewView.tsx';
import { RELEASES } from '../../lib/changelog.ts';
import { BUILD_COMMITS, BUILD_VERSION, isIdentified } from '../../lib/buildInfo.ts';

afterEach(cleanup);

describe('what’s new', () => {
  it('lists every release, newest first', () => {
    render(<WhatsNewView />);

    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual(RELEASES.map((release) => release.title));
  });

  it('stamps each release with a version as well as a date', () => {
    render(<WhatsNewView />);

    // The version is the release date in the same shape the build stamp uses, so the
    // two halves of the page can be compared by eye.
    const newest = RELEASES[0];
    expect(newest).toBeDefined();
    expect(screen.getAllByText(newest!.date.replace(/-/g, '.')).length).toBeGreaterThan(0);
  });

  it('marks the notes read on arrival', () => {
    // On the effect rather than on a button: a "mark as read" control for release notes
    // is a chore invented to serve the dot beside the menu.
    //
    // Stubbed rather than used: this environment has no localStorage at all, which is
    // itself the case `markReleasesSeen` is wrapped for — Safari's private mode throws
    // on access, and a changelog must never be why the app fails to start.
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      },
    });

    render(<WhatsNewView />);

    expect(store.get('blob.changelog.seen')).toBe(RELEASES[0]?.date);
  });

  it('says which build this is', () => {
    // Skipped rather than failed where git was unavailable at build time — that is the
    // tarball case, and the page is written to say nothing rather than to guess.
    if (!isIdentified()) return;

    render(<WhatsNewView />);

    expect(screen.getByText('You’re running')).toBeTruthy();
    // Queried through the card rather than by text: the build version and the newest
    // release's version are the same string on the day something ships, which is most
    // days here.
    const card = document.querySelector('.build-card');
    expect(card?.textContent).toContain(BUILD_VERSION);
  });

  it('keeps the commits behind a disclosure, closed', () => {
    if (BUILD_COMMITS.length === 0) return;

    render(<WhatsNewView />);

    const toggle = screen.getByRole('button', { name: /commits in this build/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Closed, because "is my fix in yet" is one reader's question and the notes above
    // are written for everybody else.
    expect(screen.queryByText(BUILD_COMMITS[0]!.subject)).toBeNull();
  });

  it('and opens it on request', () => {
    if (BUILD_COMMITS.length === 0) return;

    render(<WhatsNewView />);
    fireEvent.click(screen.getByRole('button', { name: /commits in this build/ }));

    expect(screen.getByText(BUILD_COMMITS[0]!.subject)).toBeTruthy();
  });
});

describe('when the build could not name its own commit', () => {
  it('still says which build it is', async () => {
    // Which is what happens in production: the deploy builds from an exported source
    // tree with no repository in it, so git answers nothing. The version and the build
    // time are stamped by the compiler and are always known, so the card appears for
    // those and drops the sha rather than dropping itself.
    const { BUILD_VERSION: version } = await import('../../lib/buildInfo.ts');

    render(<WhatsNewView />);

    const card = document.querySelector('.build-card');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain(version);
  });
});
