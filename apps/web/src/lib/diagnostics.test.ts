// @vitest-environment happy-dom
//
// The capture wraps `console` and reads the DOM, so it needs a document to be tested
// at all — which is the reason the bug these cover survived a green suite.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { capturePageSnapshot, installLogCapture, readLog } from './diagnostics.ts';

/**
 * These exist because the server-side tests could not have caught the bug they cover.
 * They post a console log to the API directly, so they proved the endpoint worked while
 * `installLogCapture` was never called and every real ticket arrived with an empty log.
 * What matters here is that the capture is installed and that it records.
 */
describe('log capture', () => {
  // Installed once, and never torn down. The capture is deliberately idempotent — a
  // second call does nothing — so restoring the console between tests would leave every
  // later test running against an unwrapped console, recording nothing and passing for
  // the wrong reason. That is exactly the failure this file exists to prevent.
  it('still passes everything through to the console', () => {
    const spy = vi.fn();
    console.error = spy;
    installLogCapture();

    console.error('reaches devtools');

    // Whatever else it does, the original must still be called, or this is a debugging
    // regression dressed up as a feature.
    expect(spy).toHaveBeenCalledWith('reaches devtools');
  });

  it('records level, message and time', () => {
    console.error('socket closed', { code: 1006 });
    const log = readLog();
    expect(log).toContain('[error] socket closed');
    // Objects have to survive, or half of every useful message is "[object Object]".
    expect(log).toContain('{"code":1006}');
    expect(log).toMatch(/^\d{4}-\d{2}-\d{2}T/m);
  });

  it('describes an Error without swallowing it', () => {
    console.error(new TypeError('cannot read x'));
    expect(readLog()).toContain('TypeError: cannot read x');
  });

  it('keeps a bounded buffer', () => {
    for (let i = 0; i < 400; i += 1) console.warn(`line ${i}`);
    const lines = readLog().split('\n');
    // A page left open all day cannot grow the buffer without bound.
    expect(lines.length).toBeLessThanOrEqual(300);
    expect(readLog()).toContain('line 399');
    expect(readLog()).not.toContain('line 0 ');
  });
});

describe('page snapshot', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('drops scripts so a snapshot can never execute', () => {
    document.body.innerHTML = '<p>hello</p><script>alert(1)</script>';
    const html = capturePageSnapshot();
    expect(html).toContain('hello');
    expect(html).not.toContain('alert(1)');
  });

  it('carries an input value across but never a password', () => {
    document.body.innerHTML = '<input id="a" type="text"><input id="b" type="password">';
    (document.getElementById('a') as HTMLInputElement).value = 'visible';
    (document.getElementById('b') as HTMLInputElement).value = 'hunter2';

    const html = capturePageSnapshot();
    expect(html).toContain('visible');
    expect(html).not.toContain('hunter2');
  });
});
