/**
 * What you have typed and not sent.
 *
 * Half a sentence lost to a channel switch is the kind of small betrayal people
 * remember, and Slack users have never had to think about it. So a draft lives in this
 * map, in localStorage so it survives a crash — and, since drafts became a list you can
 * open (ADR 0037), on the server too, so the next device you open has it. The note this
 * module used to carry said exactly when that would change: "a list you cannot reach from
 * your laptop is not a list."
 *
 * The server is told by `draftSync.ts`. An entry this tab has typed and the server has
 * not confirmed is `unsynced`, and nothing from elsewhere overwrites it — the composer
 * is drawn from this map, so applying a remote copy mid-sentence would take the words
 * out from under somebody's fingers. A cleared draft stays as an empty, unsynced entry
 * until the server agrees, so a message sent offline cannot bring its draft back.
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
  /** Typed here and not yet confirmed by the server: nothing from elsewhere replaces it.
   * An empty body with this set is a clear the server has still to hear about. */
  unsynced?: boolean;
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
    // An empty entry is kept only while it is a clear the server has not heard about.
    if (!entry.body.trim() && !entry.unsynced) return false;
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
 * The draft map with one key typed into, here: set, or — blank — cleared. A clear keeps
 * an empty, unsynced entry until the server has heard it (`markSynced` removes it), so
 * "has a draft" is a question about a body, not about a key.
 */
export function withDraft(
  drafts: Drafts,
  key: string,
  body: string,
  now: number = Date.now(),
): Drafts {
  const existing = drafts[key];
  const blank = !body.trim();
  if (blank && (!existing || !existing.body)) return drafts;
  if (existing?.body === body) return drafts;
  return {
    ...drafts,
    [key]: { body: blank ? '' : body, updatedAt: new Date(now).toISOString(), unsynced: true },
  };
}

/** The server has `sentBody` for this key. If nothing was typed since, it is in sync — and
 *  a clear is finished, so its entry goes. */
export function markSynced(drafts: Drafts, key: string, sentBody: string): Drafts {
  const entry = drafts[key];
  if (!entry || entry.body !== sentBody || !entry.unsynced) return drafts;
  if (!sentBody) {
    const rest = { ...drafts };
    delete rest[key];
    return rest;
  }
  return { ...drafts, [key]: { ...entry, unsynced: false } };
}

/** Another of your devices changed this draft. Taken unless this tab has typed something
 *  the server has not confirmed yet. */
export function applyRemote(drafts: Drafts, key: string, body: string, updatedAt: string): Drafts {
  const entry = drafts[key];
  if (entry?.unsynced) return drafts;
  if (!body.trim()) {
    if (!entry) return drafts;
    const rest = { ...drafts };
    delete rest[key];
    return rest;
  }
  if (entry?.body === body) return drafts;
  return { ...drafts, [key]: { body, updatedAt } };
}

/** On arrival: what this tab typed and never got confirmed wins and is sent again;
 *  otherwise the server's list is the truth, and a confirmed draft it no longer has was
 *  sent or cleared somewhere else. */
export function mergeServer(
  local: Drafts,
  server: ReadonlyArray<{ key: string; body: string; updatedAt: string }>,
): Drafts {
  const merged: Drafts = {};
  for (const [key, entry] of Object.entries(local)) {
    if (entry.unsynced) merged[key] = entry;
  }
  for (const draft of server) {
    if (merged[draft.key]) continue;
    merged[draft.key] = { body: draft.body, updatedAt: draft.updatedAt };
  }
  return merged;
}

/** The channel and thread a key names — `draftKey` read backwards. */
export function parseDraftKey(key: string): { channelId: string; threadRootId: string | null } {
  const [channelId = key, threadRootId] = key.split(':');
  return { channelId, threadRootId: threadRootId ?? null };
}

/** Whether this channel has an unsent draft anywhere in it — the channel or a thread. */
export function channelHasDraft(drafts: Drafts, channelId: string): boolean {
  return Object.entries(drafts).some(
    ([key, entry]) =>
      entry.body.trim() !== '' && (key === channelId || key.startsWith(`${channelId}:`)),
  );
}
