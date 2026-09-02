/** What's new — every update that has shipped, and what it changed.
 *
 * Reached from the account menu, where a row labelled "Update" has sat disabled and
 * marked "Soon" since the menu was built. This is that row.
 *
 * Opening the page is what marks it read, on the effect rather than on a button: a
 * "mark as read" control for release notes is a chore invented to serve the dot beside
 * the menu, and the dot exists to serve the reader, not the other way round.
 *
 * Two audiences, in two halves, and the split is deliberate. The notes above are written
 * for somebody using Blob; the build below is for somebody who needs to know *which*
 * Blob they are using — which version, which commit, when it went out, and what was in
 * it. That second question has one honest answer in an app that deploys continuously
 * from main, and it is the commit. It is stamped into the bundle at build time rather
 * than fetched, because a page describing a build must not depend on a request another
 * build could answer.
 */

import { useEffect, useState } from 'react';
import { useStore } from '../../lib/store.ts';
import {
  RELEASES,
  formatReleaseDate,
  labelFor,
  markReleasesSeen,
  type Release,
} from '../../lib/changelog.ts';
import {
  BUILD_BRANCH,
  BUILD_COMMIT_SHORT,
  BUILD_TIME,
  BUILD_VERSION,
  commitUrl,
  commitsAreExact,
  commitsByDay,
  formatBuildTime,
  isIdentified,
} from '../../lib/buildInfo.ts';

/**
 * The version and commit this build is.
 *
 * Two sources, in that order of authority. The bundle stamps its own commit in at build
 * time, which is exact — but only where the build could read a repository, and a host
 * that deploys an exported source tree cannot. So the server, which is *told* what it is
 * running by whoever deployed it, is the fallback. Neither answering means the card is
 * absent: "commit unknown" is worse than not raising the subject.
 */
function ThisBuild() {
  const serverCommit = useStore((s) => s.serverCommit);
  const commit = isIdentified() ? BUILD_COMMIT_SHORT : (serverCommit ?? '').slice(0, 7);
  if (!commit) return null;

  const link = commitUrl(isIdentified() ? BUILD_COMMIT_SHORT : (serverCommit ?? ''));
  const built = formatBuildTime(BUILD_TIME);

  return (
    <section className="build-card">
      <div className="build-card-main">
        <span className="build-label">You’re running</span>
        <span className="build-version">{BUILD_VERSION}</span>
        {link ? (
          <a className="build-sha" href={link} target="_blank" rel="noreferrer noopener">
            {commit}
          </a>
        ) : (
          <span className="build-sha">{commit}</span>
        )}
      </div>
      <div className="build-card-meta muted">
        {built && <span>Built {built}</span>}
        {/* The branch only says something when it is not the one everything deploys
            from — on main it is noise, and on anything else it is the single most
            important fact on the page. */}
        {BUILD_BRANCH && BUILD_BRANCH !== 'main' && (
          <span className="build-branch">on {BUILD_BRANCH}</span>
        )}
      </div>
    </section>
  );
}

/**
 * Every commit in this build, by the day it was written.
 *
 * Behind a disclosure, and closed: this is the answer to "is my fix in yet", which is a
 * question somebody comes here already asking. Open by default it would bury the notes
 * that are written for everybody else under a wall of commit subjects.
 */
function WhatWentIn() {
  const [open, setOpen] = useState(false);
  const days = commitsByDay();
  if (days.length === 0) return null;

  const total = days.reduce((count, day) => count + day.commits.length, 0);

  return (
    <section className="build-log">
      <button
        type="button"
        className="build-log-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? 'Hide' : 'Show'} the {total}{' '}
        {commitsAreExact() ? 'commits in this build' : 'most recent commits'}
      </button>

      {open && (
        <div className="build-log-body">
          {days.map((day) => (
            <div key={day.date} className="build-day">
              <h3 className="build-day-date">{formatReleaseDate(day.date)}</h3>
              <ul className="build-commits">
                {day.commits.map((commit) => {
                  const link = commitUrl(commit.sha);
                  return (
                    <li key={commit.sha} className="build-commit">
                      {link ? (
                        <a
                          className="build-commit-sha"
                          href={link}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {commit.shortSha}
                        </a>
                      ) : (
                        <span className="build-commit-sha">{commit.shortSha}</span>
                      )}
                      <span className="build-commit-subject">{commit.subject}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

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
        <ThisBuild />

        {RELEASES.map((release: Release, index: number) => (
          // The date is the identity, and two releases can share one — the key is the
          // pair, or two updates shipped on the same day would collide.
          <section key={`${release.date}-${index}`} className="release">
            <div className="release-head">
              <h2 className="release-title">{release.title}</h2>
              <div className="release-stamp">
                <span className="release-version">{release.date.replace(/-/g, '.')}</span>
                <time className="release-date" dateTime={release.date}>
                  {formatReleaseDate(release.date)}
                </time>
              </div>
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

        <WhatWentIn />

        <p className="muted release-foot">
          Blob deploys straight from its main branch, so these notes ship with the build
          you are running rather than being written about it afterwards. The version is
          the date of the commit it was built from — nothing here is tagged, and a made-up
          release number would say less than a date does.
        </p>
      </div>
    </main>
  );
}
