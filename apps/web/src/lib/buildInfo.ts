/** Which build this is, and what went into it.
 *
 * Blob deploys straight from main, so "the version" is not a tag somebody cut — it is
 * the commit the running bundle was built from. That is the honest identity, and it is
 * also the one that answers the question people actually ask when something looks wrong:
 * *is the fix I am waiting for in this?*
 *
 * Everything here is stamped in at build time by `vite.config.ts`, which reads git once
 * and inlines the answer. Nothing is fetched: a page describing the build cannot depend
 * on a request that might be served by a different one.
 *
 * When git is not available — a `vite dev` in a tarball, a sandbox with no `.git` — the
 * constants come through empty and every reader here degrades to "unknown". The page
 * hides what it does not know rather than printing a placeholder, because "commit
 * unknown" is worse than not mentioning commits.
 */

declare const __BUILD_COMMIT__: string;
declare const __BUILD_COMMIT_SHORT__: string;
declare const __BUILD_TIME__: string;
declare const __BUILD_BRANCH__: string;
declare const __BUILD_VERSION__: string;
declare const __BUILD_REPO_URL__: string;
declare const __BUILD_COMMITS__: string;

/** One commit, as the page lists it. */
export interface BuildCommit {
  sha: string;
  shortSha: string;
  subject: string;
  /** ISO 8601 with an offset — the author's own clock, which is what git records. */
  date: string;
  author: string;
}

function constant(name: string, value: () => string): string {
  try {
    return value();
  } catch {
    // A `define` that was never substituted throws a ReferenceError on read. That is
    // the vitest and tarball case, and it is not an error worth propagating.
    void name;
    return '';
  }
}

/** The commit this bundle was built from, or "" when the build could not tell. */
export const BUILD_COMMIT = constant('commit', () => __BUILD_COMMIT__);
export const BUILD_COMMIT_SHORT = constant('short', () => __BUILD_COMMIT_SHORT__);
export const BUILD_BRANCH = constant('branch', () => __BUILD_BRANCH__);
/** ISO instant the bundle was compiled — the closest thing to "when this deployed". */
export const BUILD_TIME = constant('time', () => __BUILD_TIME__);

/**
 * Calendar version: the date of the commit this was built from.
 *
 * Not a semantic version, and deliberately. Nothing here is released on a cadence,
 * nothing is tagged, and every package in the workspace still says 0.1.0 — numbering
 * these 0.2 through 0.9 after the fact would be inventing a history that did not happen.
 * A date is true, it sorts, and it answers the only question a version is asked in a
 * continuously deployed app: is mine newer than yours.
 */
export const BUILD_VERSION = constant('version', () => __BUILD_VERSION__);

/** Where a commit can be read in full. Empty when the remote is not a web host. */
export const REPO_URL = constant('repo', () => __BUILD_REPO_URL__);

/** The commits in this build, newest first. Empty when git was not available. */
export const BUILD_COMMITS: readonly BuildCommit[] = (() => {
  const raw = constant('commits', () => __BUILD_COMMITS__);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BuildCommit[]) : [];
  } catch {
    return [];
  }
})();

/** True when this build knows which commit it is. */
export function isIdentified(): boolean {
  return BUILD_COMMIT_SHORT !== '';
}

/** `https://github.com/owner/repo/commit/<sha>`, or "" when there is nowhere to link. */
export function commitUrl(sha: string): string {
  return REPO_URL && sha ? `${REPO_URL}/commit/${sha}` : '';
}

/** "2 September 2026, 04:12" — long, because this is read rarely and read carefully. */
export function formatBuildTime(iso: string): string {
  if (!iso) return '';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Commits grouped by the day they were authored, newest day first.
 *
 * A deploy is a push, and a push is whatever had accumulated since the last one — which
 * git does not record. The day is the closest honest grouping, and it is the one the
 * release notes above are already keyed by, so the two halves of the page line up.
 */
export function commitsByDay(
  commits: readonly BuildCommit[] = BUILD_COMMITS,
): Array<{ date: string; commits: BuildCommit[] }> {
  const days = new Map<string, BuildCommit[]>();
  for (const commit of commits) {
    const day = commit.date.slice(0, 10);
    const existing = days.get(day);
    if (existing) existing.push(commit);
    else days.set(day, [commit]);
  }
  return [...days.entries()]
    .map(([date, entries]) => ({ date, commits: entries }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
