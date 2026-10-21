/** Telling the server about drafts (ADR 0037), a pause at a time.
 *
 * `drafts.ts` keeps the map and its rules; this keeps the timers. A key is saved
 * `DEBOUNCE_MS` after its last keystroke, one request at a time per key, and whatever was
 * typed during a request goes in the next one. What the server confirms is marked in sync
 * through `connectDraftSync`'s `settled`; what fails on the network stays unsynced and
 * goes again on the next keystroke or the next arrival. A refusal — the room was left,
 * archived, or never yours — settles it too, rather than asking again for ever.
 */

import { api, ApiError } from './api.ts';
import { parseDraftKey, type DraftEntry } from './drafts.ts';

/** This tab, so its own saves coming back over the socket can be told apart. */
export const DEVICE_ID = globalThis.crypto?.randomUUID?.() ?? `tab-${Date.now()}`;

const DEBOUNCE_MS = 700;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Set<string>();

let read: (key: string) => DraftEntry | undefined = () => undefined;
let settled: (key: string, sentBody: string) => void = () => undefined;

/** Wired once by the store, which owns the map: how to read a draft, and how to mark one
 *  the server now has. */
export function connectDraftSync(
  reader: (key: string) => DraftEntry | undefined,
  onSettled: (key: string, sentBody: string) => void,
): void {
  read = reader;
  settled = onSettled;
}

export function scheduleDraftSync(key: string, delayMs = DEBOUNCE_MS): void {
  const pending = timers.get(key);
  if (pending !== undefined) clearTimeout(pending);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void push(key);
    }, delayMs),
  );
}

/** Whether this tab still owes the server something for this key. */
export function hasPendingDraftSync(key: string): boolean {
  return timers.has(key) || inFlight.has(key);
}

async function push(key: string): Promise<void> {
  if (inFlight.has(key)) {
    // One at a time per key: the answer to the earlier save could otherwise land last.
    scheduleDraftSync(key);
    return;
  }
  const entry = read(key);
  if (!entry?.unsynced) return;
  const body = entry.body;
  inFlight.add(key);
  try {
    await api.drafts.save({ ...parseDraftKey(key), body, device: DEVICE_ID });
    settled(key, body);
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429) {
      settled(key, body);
    }
  } finally {
    inFlight.delete(key);
  }
}

/** The tab is going away: what is still owed goes now, in requests that outlive it. */
export function flushDraftSyncs(): void {
  for (const [key, timer] of timers) {
    clearTimeout(timer);
    const entry = read(key);
    if (entry?.unsynced) {
      api.drafts.saveOnUnload({ ...parseDraftKey(key), body: entry.body, device: DEVICE_ID });
    }
  }
  timers.clear();
}

/** Signing out: nothing more is owed to a session that is gone. */
export function cancelDraftSyncs(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}
