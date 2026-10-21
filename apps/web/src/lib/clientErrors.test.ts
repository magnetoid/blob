// @vitest-environment happy-dom
/**
 * The client reports what nothing caught (ADR 0025's addendum) — once per fault, ten at
 * most a page load — and never what the app already answers: a refused request, an
 * aborted one, a dropped connection, a browser extension's error.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { api, ApiError } from './api.ts';
import { installClientErrorReporting, reportClientError, resetClientErrorReports } from './clientErrors.ts';

let report: MockInstance<typeof api.clientErrors.report>;

beforeEach(() => {
  resetClientErrorReports();
  report = vi.spyOn(api.clientErrors, 'report').mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function thrown(message: string, frame = 'at render (https://chat.example/assets/index.js:1:2)') {
  const error = new TypeError(message);
  error.stack = `TypeError: ${message}\n    ${frame}`;
  return error;
}

describe('reportClientError', () => {
  it('sends a fault with its stack, the path and nothing else', () => {
    reportClientError(thrown("cannot read 'x' of undefined"));
    expect(report).toHaveBeenCalledTimes(1);
    const sent: Record<string, unknown> = report.mock.calls[0]![0];
    expect(sent.message).toBe("TypeError: cannot read 'x' of undefined");
    expect(String(sent.stack)).toContain('index.js:1:2');
    expect(sent.path).toBe(window.location.pathname);
    expect(Object.keys(sent).sort()).toEqual(['message', 'path', 'release', 'stack']);
  });

  it('sends a fault once a page load, and at most ten', () => {
    reportClientError(thrown('same'));
    reportClientError(thrown('same'));
    expect(report).toHaveBeenCalledTimes(1);
    for (let n = 0; n < 20; n += 1) reportClientError(thrown(`fault ${n}`));
    expect(report).toHaveBeenCalledTimes(10);
  });

  it('leaves alone what the app already answers', () => {
    reportClientError(new ApiError(500, 'internal', 'boom'));
    reportClientError(new DOMException('aborted', 'AbortError'));
    reportClientError(new TypeError('Failed to fetch'));
    reportClientError(new Error('Script error.'));
    reportClientError(thrown('from an extension', 'at x (chrome-extension://abc/content.js:1:1)'));
    reportClientError(undefined);
    expect(report).not.toHaveBeenCalled();
  });

  it('never fails because the report did', async () => {
    report.mockRejectedValue(new Error('offline'));
    expect(() => reportClientError(thrown('unlucky'))).not.toThrow();
    await Promise.resolve();
  });
});

describe('installClientErrorReporting', () => {
  it('hears what nothing caught, until it is stopped', () => {
    const stop = installClientErrorReporting();
    window.dispatchEvent(new ErrorEvent('error', { error: thrown('uncaught'), message: 'uncaught' }));
    expect(report).toHaveBeenCalledTimes(1);
    stop();
    window.dispatchEvent(new ErrorEvent('error', { error: thrown('later'), message: 'later' }));
    expect(report).toHaveBeenCalledTimes(1);
  });
});
