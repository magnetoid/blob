import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Ask git one question, or give up quietly.
 *
 * Every caller has a usable fallback, because a build must not fail for want of a commit
 * subject — `vite build` runs in a Docker stage, in CI, and on a laptop with a dirty
 * tree, and only one of those is guaranteed a repository.
 */
function git(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

/** The last N commits, as structured records rather than as a formatted blob. */
function recentCommits(limit: number) {
  // Unit separator between fields and record separator between commits: a commit
  // subject can contain anything a person can type, tabs and pipes included, so the
  // delimiter has to be something a keyboard does not produce.
  const raw = git(['log', `-${limit}`, '--no-merges', '--pretty=format:%H%x1f%h%x1f%s%x1f%aI%x1f%an%x1e']);
  if (!raw) return [];
  return raw
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha = '', shortSha = '', subject = '', date = '', author = ''] = record.split('\x1f');
      return { sha, shortSha, subject, date, author };
    })
    .filter((commit) => commit.sha !== '');
}

/**
 * `git@github.com:owner/repo.git` and `https://github.com/owner/repo.git` both become
 * `https://github.com/owner/repo`, which is what a commit link needs. Anything that is
 * not an http(s)-reachable host becomes "" and the page simply does not link.
 */
function repoWebUrl(): string {
  const origin = git(['config', '--get', 'remote.origin.url']);
  if (!origin) return '';
  const ssh = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(origin);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  const https = /^https?:\/\/(?:[^@]+@)?(.+?)(?:\.git)?$/.exec(origin);
  if (https) return `https://${https[1]}`;
  return '';
}

const commit = git(['rev-parse', 'HEAD']);
const commitDate = git(['log', '-1', '--pretty=format:%cI']);

export default defineConfig({
  plugins: [react()],
  /**
   * The build stamps its own identity in. Read once here, in Node, rather than fetched
   * at runtime: a page that describes the build it belongs to must not depend on a
   * request that a *different* build could answer.
   *
   * `JSON.stringify` on every value because `define` performs textual substitution — an
   * unquoted string would be spliced in as an identifier.
   */
  define: {
    __BUILD_COMMIT__: JSON.stringify(commit),
    __BUILD_COMMIT_SHORT__: JSON.stringify(git(['rev-parse', '--short', 'HEAD'])),
    __BUILD_BRANCH__: JSON.stringify(git(['rev-parse', '--abbrev-ref', 'HEAD'])),
    // Calendar version: the date of the commit, which is the only version a
    // continuously deployed app honestly has. See `lib/buildInfo.ts`.
    __BUILD_VERSION__: JSON.stringify(commitDate.slice(0, 10).replace(/-/g, '.')),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __BUILD_REPO_URL__: JSON.stringify(repoWebUrl()),
    // Enough to cover several deploys of history, small enough that it is a rounding
    // error next to the bundle. Merges are excluded: they say nothing a reader wants.
    // A shallow clone yields however few it has, which is a shorter list and not an
    // error — the page renders whatever it is given.
    __BUILD_COMMITS__: JSON.stringify(JSON.stringify(recentCommits(60))),
  },
  server: {
    port: 5173,
    // The API and the socket live on the server process; proxying keeps the browser
    // on one origin so session cookies work without CORS.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    // 'hidden' keeps the maps for a debugging operator without advertising them in
    // every served bundle.
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks: {
          // React changes on a different cadence from the app; a separate chunk means
          // an app deploy doesn't re-download the framework.
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
