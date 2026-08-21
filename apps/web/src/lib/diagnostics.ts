/** What a feedback ticket carries besides the words: the log, and the page itself.
 *
 * Both are captured at the moment of submitting, because a bug report that says "it
 * broke" is worth far less than one that ships the console output and the screen it
 * happened on.
 */

const LOG_LIMIT = 300;
const LOG_BYTES = 64 * 1024;
const SNAPSHOT_BYTES = 2 * 1024 * 1024;

export interface LogLine {
  at: string;
  level: 'log' | 'info' | 'warn' | 'error';
  text: string;
}

const buffer: LogLine[] = [];

function record(level: LogLine['level'], args: unknown[]): void {
  buffer.push({ at: new Date().toISOString(), level, text: args.map(describe).join(' ') });
  // A ring, so a page left open all day cannot grow without bound.
  if (buffer.length > LOG_LIMIT) buffer.splice(0, buffer.length - LOG_LIMIT);
}

function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

let installed = false;

/**
 * Wraps the console rather than replacing it: everything still reaches devtools, and
 * the original methods are what actually print, so this is invisible in normal use.
 */
export function installLogCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      record(level, args);
      original(...args);
    };
  }

  window.addEventListener('error', (event) => {
    record('error', [`${event.message} (${event.filename}:${event.lineno})`]);
  });
  window.addEventListener('unhandledrejection', (event) => {
    record('error', [`Unhandled rejection: ${describe(event.reason)}`]);
  });
}

export function readLog(): string {
  const text = buffer.map((line) => `${line.at} [${line.level}] ${line.text}`).join('\n');
  return text.length > LOG_BYTES ? text.slice(-LOG_BYTES) : text;
}

/**
 * A snapshot of the page as it stands, as HTML that can be rendered back.
 *
 * Not a rasterized image: producing one in the browser needs a heavyweight dependency
 * that renders approximately at best. Serialized markup is exact, costs nothing, and
 * stays inspectable — the admin view renders it in a sandboxed iframe.
 *
 * Two things are rewritten on the way out. Inputs do not serialize their current value,
 * so it is written back as an attribute; and scripts are dropped, since the snapshot is
 * replayed inside the admin console and must never execute.
 */
export function capturePageSnapshot(): string {
  if (typeof document === 'undefined') return '';

  const clone = document.documentElement.cloneNode(true) as HTMLElement;

  for (const script of Array.from(clone.querySelectorAll('script'))) script.remove();

  const liveInputs = document.querySelectorAll('input, textarea, select');
  const clonedInputs = clone.querySelectorAll('input, textarea, select');
  clonedInputs.forEach((node, index) => {
    const live = liveInputs[index];
    if (!live) return;
    if (live instanceof HTMLInputElement) {
      // Never carry a password into a ticket an admin will read.
      if (live.type === 'password') node.setAttribute('value', '');
      else node.setAttribute('value', live.value);
    } else if (live instanceof HTMLTextAreaElement) {
      node.textContent = live.value;
    }
  });

  // The theme is applied as inline custom properties on <html>, and cloneNode keeps
  // them, so the snapshot renders in the theme the reporter was actually looking at.
  const html = `<!doctype html>\n<html${attributes(document.documentElement)}>${clone.innerHTML}</html>`;
  return html.length > SNAPSHOT_BYTES ? html.slice(0, SNAPSHOT_BYTES) : html;
}

function attributes(element: HTMLElement): string {
  return Array.from(element.attributes)
    .map((attribute) => ` ${attribute.name}="${attribute.value.replace(/"/g, '&quot;')}"`)
    .join('');
}

export function describeEnvironment(): Record<string, string> {
  return {
    url: window.location.pathname + window.location.search,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    language: navigator.language,
  };
}
