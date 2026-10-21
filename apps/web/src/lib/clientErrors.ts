/**
 * Errors the client throws in a person's browser, sent to the server for this workspace's
 * admins to see on the Health page (ADR 0025's addendum).
 *
 * Once per fault per page load and ten at most, so a render loop cannot flood anything;
 * and only the message, the stack, the path and this build's commit — never what was on
 * screen or typed. The server cuts even that down before keeping it. Errors the app
 * already answers are not faults and are not sent: a refused request, a cancelled one, a
 * dropped connection, and anything a browser extension threw into the page.
 */

import { api, ApiError } from './api.ts';
import { BUILD_COMMIT_SHORT } from './buildInfo.ts';

const MAX_PER_PAGE = 10;
const sent = new Set<string>();

/** Forget what this page load has sent — for tests. */
export function resetClientErrorReports(): void {
  sent.clear();
}

function asError(thrown: unknown): Error | null {
  if (thrown instanceof Error) return thrown;
  if (typeof thrown === 'string' && thrown.trim()) return new Error(thrown);
  return null;
}

function isFault(error: Error): boolean {
  if (error instanceof ApiError) return false;
  if (error.name === 'AbortError') return false;
  // A fetch that never reached the server: the connection, not the code.
  if (error instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(error.message)) {
    return false;
  }
  // A cross-origin script's error arrives with every detail stripped; nothing to act on.
  if (error.message === 'Script error.') return false;
  if (/ResizeObserver loop/.test(error.message)) return false;
  if (/(?:chrome|moz|safari(?:-web)?)-extension:\/\//.test(error.stack ?? '')) return false;
  return true;
}

export function reportClientError(thrown: unknown): void {
  if (sent.size >= MAX_PER_PAGE) return;
  const error = asError(thrown);
  if (!error || !isFault(error)) return;
  const firstFrame = (error.stack ?? '').split('\n').find((line) => /\bat\b|@/.test(line)) ?? '';
  const key = `${error.message}\n${firstFrame.trim()}`;
  if (sent.has(key)) return;
  sent.add(key);
  void api.clientErrors
    .report({
      message: `${error.name}: ${error.message}`,
      stack: error.stack ?? null,
      path: window.location.pathname,
      release: BUILD_COMMIT_SHORT || null,
    })
    .catch(() => {
      // A report that cannot be delivered is dropped: reporting must never be a fault.
    });
}

/** Listen for what nothing caught. Returns the way to stop. */
export function installClientErrorReporting(): () => void {
  const onError = (event: ErrorEvent) => reportClientError(event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => reportClientError(event.reason);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
