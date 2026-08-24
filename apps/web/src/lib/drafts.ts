/**
 * What you have typed and not sent.
 *
 * A draft is the one piece of state in this app that has no server behind it and still
 * has to survive. Nothing has been sent, so there is nothing to persist and nothing to
 * broadcast — but half a sentence lost to a channel switch is the kind of small betrayal
 * people remember, and Slack users have never had to think about it.
 *
 * Stored in localStorage rather than on the server, which is the honest trade rather
 * than the lazy one: a draft is tied to the machine you were typing on, and syncing it
 * would mean a write path for text the author has not decided to share. When drafts
 * become a *list* you can open — Slack's "Drafts & sent" — that calculus changes,
 * because a list you cannot reach from your laptop is not a list.
 *
 * Keyed by channel, and separately by thread: replying in a thread and talking in the
 * channel are two places to be mid-sentence, and Slack keeps them apart.
 */

const STORAGE_KEY = 'blob.web.drafts.v1';

/** Forget a draft nobody has touched in a month. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Cap on how many are kept, oldest evicted first.
 *
 * Without it this map is append-only for the life of the browser profile: every channel
 * you ever abandoned a sentence in, forever, in a store with a few megabytes to give.
 */
const MAX_DRAFTS = 200;

export interface DraftEntry {
  body: string;
  /** ISO 8601. Drives both the eviction order and the age cutoff. */
  updatedAt: string;
}

export type Drafts = Record<string, DraftEntry>;

/** A channel and a thread inside it are different places to be typing. */
export function draftKey(channelId: string, threadRootId?: string | null): string {
  return threadRootId ? `${channelId}:${threadRootId}` : channelId;
}

function hasStorage(): boolean {
  try {
    return typeof globalThis.localStorage !== 'undefined';
  } catch {
    // Accessing localStorage throws outright in some privacy modes rather than
    // returning null, so this is a try/catch and not a truthiness check.
    return false;
  }
}

function isDrafts(value: unknown): value is Drafts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as DraftEntry).body === 'string' &&
      typeof (entry as DraftEntry).updatedAt === 'string',
  );
}

/**
 * Drop what is stale and what does not fit.
 *
 * Exported for the test, and because the eviction rule is the part worth stating out
 * loud: newest kept, and an unparseable date sorts oldest so a corrupt entry leaves
 * rather than pinning a slot forever.
 */
export function pruneDrafts(drafts: Drafts, now: number): Drafts {
  const fresh = Object.entries(drafts).filter(([, entry]) => {
    if (!entry.body.trim()) return false;
    const at = Date.parse(entry.updatedAt);
    return Number.isFinite(at) && now - at < MAX_AGE_MS;
  });

  if (fresh.length <= MAX_DRAFTS) return Object.fromEntries(fresh);

  return Object.fromEntries(
    fresh
      .sort(([, a], [, b]) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))
      .slice(0, MAX_DRAFTS),
  );
}

export function loadDrafts(now: number = Date.now()): Drafts {
  if (!hasStorage()) return {};
  const raw = globalThis.localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isDrafts(parsed)) return {};
    return pruneDrafts(parsed, now);
  } catch {
    return {};
  }
}

/**
 * Write, but not on every keystroke.
 *
 * `persistDrafts` serialises the whole map. Called from the composer's onChange that is
 * a stringify of every draft you hold, per character typed — invisible with three of
 * them and not with a hundred. The in-memory state still updates immediately; only the
 * copy that survives a crash lags, by at most `delayMs`.
 */
let pendingWrite: Drafts | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

export function schedulePersist(drafts: Drafts, delayMs = 400): void {
  pendingWrite = drafts;
  if (writeTimer !== null) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const next = pendingWrite;
    pendingWrite = null;
    if (next) persistDrafts(next);
  }, delayMs);
}

/** Write anything owed right now — before the tab goes away, where a timer will not fire. */
export function flushDrafts(): void {
  if (writeTimer !== null) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  const next = pendingWrite;
  pendingWrite = null;
  if (next) persistDrafts(next);
}

export function persistDrafts(drafts: Drafts): void {
  if (!hasStorage()) return;
  if (Object.keys(drafts).length === 0) {
    globalThis.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // Quota, most likely, and a draft is not worth breaking a keystroke over. The one in
    // memory still works for this session; only the crash-survival is lost.
  }
}

/**
 * The draft map with one key set, or removed when the body is blank.
 *
 * Blank removes rather than storing an empty string, so "has a draft" stays a question
 * about key presence — which is what the sidebar's indicator reads.
 */
export function withDraft(
  drafts: Drafts,
  key: string,
  body: string,
  now: number = Date.now(),
): Drafts {
  if (!body.trim()) {
    if (!(key in drafts)) return drafts;
    const rest = { ...drafts };
    delete rest[key];
    return rest;
  }
  const existing = drafts[key];
  if (existing?.body === body) return drafts;
  return { ...drafts, [key]: { body, updatedAt: new Date(now).toISOString() } };
}

/** Whether this channel has an unsent draft anywhere in it — the channel or a thread. */
export function channelHasDraft(drafts: Drafts, channelId: string): boolean {
  return Object.keys(drafts).some((key) => key === channelId || key.startsWith(`${channelId}:`));
}
