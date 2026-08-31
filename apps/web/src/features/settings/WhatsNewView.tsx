/** What's new — every update that has shipped, and what it changed.
 *
 * Reached from the account menu, where a row labelled "Update" has sat disabled and
 * marked "Soon" since the menu was built. This is that row.
 *
 * Opening the page is what marks it read, on the effect rather than on a button: a
 * "mark as read" control for release notes is a chore invented to serve the dot beside
 * the menu, and the dot exists to serve the reader, not the other way round.
 */

import { useEffect } from 'react';
import {
  RELEASES,
  formatReleaseDate,
  labelFor,
  markReleasesSeen,
  type Release,
} from '../../lib/changelog.ts';

export function WhatsNewView() {
  useEffect(() => {
    markReleasesSeen();
  }, []);

  return (
    <main className="pane">
      <header className="pane-header">
        <div style={{ minWidth: 0 }}>
          <div className="pane-heading">
            <h1 className="pane-title">What's new</h1>
          </div>
          <div className="pane-sub">
            Everything that has shipped here, newest first
          </div>
        </div>
      </header>

      <div className="whats-new">
        {RELEASES.map((release: Release, index: number) => (
          // The date is the identity, and two releases can share one — the key is the
          // pair, or two updates shipped on the same day would collide.
          <section key={`${release.date}-${index}`} className="release">
            <div className="release-head">
              <h2 className="release-title">{release.title}</h2>
              <time className="release-date" dateTime={release.date}>
                {formatReleaseDate(release.date)}
              </time>
            </div>

            <ul className="release-entries">
              {release.entries.map((entry, entryIndex) => (
                <li key={entryIndex} className="release-entry">
                  <span className="release-tag" data-kind={entry.kind}>
                    {labelFor(entry.kind)}
                  </span>
                  <span>{entry.text}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="muted release-foot">
          Blob deploys straight from its main branch, so these notes ship with the build
          you are running rather than being written about it afterwards.
        </p>
      </div>
    </main>
  );
}
