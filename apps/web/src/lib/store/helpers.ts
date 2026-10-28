/**
 * Pure helpers over the store's state — message lists, reactions, the outbox overlay and
 * the "fresh" marks. Split out of `store.ts`, which is their only caller; `State` is
 * imported as a type only, so the cycle is erased at compile time.
 */

import type { StateCreator } from "zustand";
import type { CurrentUser, Message } from "@blob/shared";
import {
  materializeOutboxMessage,
  persistOutbox,
  sortOutbox,
  type LocalOutboxEntry,
} from "../outbox.ts";
import { FALLBACK_MS } from "../usePresence.ts";
import type { ChannelMessages, State } from "../store.ts";

/**
 * One sorted list from two.
 *
 * Where a fetched page meets messages that arrived while it was being fetched. Both
 * sides are sorted by id — ids are UUIDv7, so "sorted by id" is "sorted by time" — so
 * this is a single pass, not one `upsert` per arrival. An arrived row wins over the
 * page's copy of the same id, and over an optimistic copy carrying its `clientMsgId`.
 */
export function mergeById(page: Message[], arrived: Message[]): Message[] {
  if (arrived.length === 0) return page;
  const incoming = arrived.slice().sort(byId);
  const arrivedIds = new Set(incoming.map((m) => m.id));
  const twins = new Set(
    incoming.flatMap((m) => (m.clientMsgId ? [m.clientMsgId] : [])),
  );
  const base = twins.size
    ? page.filter(
        (m) =>
          arrivedIds.has(m.id) || !(m.clientMsgId && twins.has(m.clientMsgId)),
      )
    : page;
  const merged: Message[] = [];
  let i = 0;
  let j = 0;
  while (i < base.length && j < incoming.length) {
    const a = base[i] as Message;
    const b = incoming[j] as Message;
    if (a.id === b.id) {
      merged.push(b);
      i += 1;
      j += 1;
    } else if (a.id < b.id) {
      merged.push(a);
      i += 1;
    } else {
      merged.push(b);
      j += 1;
    }
  }
  while (i < base.length) merged.push(base[i++] as Message);
  while (j < incoming.length) merged.push(incoming[j++] as Message);
  return merged;
}

function byId(a: Message, b: Message): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** How many recent tags are kept of each kind: the server's `mention_recency.KEEP`. */
const RECENT_MENTIONS_KEPT = 30;

/**
 * `ids` at the front of `list`, in the order given, each once, then capped.
 *
 * The same array back when nothing moved. Every send is applied twice — as the request's
 * answer and again as its own socket frame — and the second must not hand every
 * composer a new list to re-rank.
 */
export function taggedFirst(list: string[], ids: readonly string[]): string[] {
  if (ids.length === 0) return list;
  const next = [...new Set([...ids, ...list])].slice(0, RECENT_MENTIONS_KEPT);
  return next.length === list.length && next.every((id, i) => id === list[i]) ? list : next;
}

/** `list` without `ids`, or the same array when none of them was in it. */
export function without(list: string[], ids: readonly string[]): string[] {
  if (!ids.some((id) => list.includes(id))) return list;
  return list.filter((id) => !ids.includes(id));
}

/** The index of `id`, or where it would go: binary search over an id-sorted list. */
function positionOf(items: Message[], id: string): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((items[mid] as Message).id < id) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Insert or replace a message, keeping the list sorted by id. */
export function upsert(items: Message[], message: Message): Message[] {
  const at = positionOf(items, message.id);
  if (at < items.length && (items[at] as Message).id === message.id) {
    const next = items.slice();
    next[at] = message;
    return next;
  }
  const next = items.slice();
  if (message.clientMsgId) {
    // The optimistic copy of this same send, under its pending id. Newest sends sit
    // at the tail, so the scan runs backwards and is short in practice.
    for (let k = next.length - 1; k >= 0; k -= 1) {
      if ((next[k] as Message).clientMsgId === message.clientMsgId) {
        next.splice(k, 1);
        break;
      }
    }
  }
  next.splice(positionOf(next, message.id), 0, message);
  return next;
}

/** `items.map(fn)`, but the same array when nothing changed — identity is what stops
 *  a re-render, and most events touch one message in one place. */
export function mapItems(items: Message[], fn: (message: Message) => Message): Message[] {
  let next: Message[] | null = null;
  for (let index = 0; index < items.length; index += 1) {
    const before = items[index] as Message;
    const after = fn(before);
    if (after !== before) {
      if (next === null) next = items.slice();
      next[index] = after;
    }
  }
  return next ?? items;
}

/**
 * Whether a message belongs in its channel's own list.
 *
 * Thread replies live in the thread. The exception is the one whose author ticked "Also
 * send to #channel", which is deliberately in both — `services/messages.IN_CHANNEL_HISTORY`
 * is the server half of this same sentence.
 */
export function inChannelHistory(message: Message): boolean {
  return !message.threadRootId || message.alsoInChannel;
}

export function mapChannel(
  messages: Record<string, ChannelMessages>,
  channelId: string,
  fn: (message: Message) => Message,
): Record<string, ChannelMessages> {
  const existing = messages[channelId];
  if (!existing) return messages;
  const items = mapItems(existing.items, fn);
  if (items === existing.items) return messages;
  return { ...messages, [channelId]: { ...existing, items } };
}

/** The same, for one thread: the root's own list, or the one the reply is in. */
export function mapThread(
  threads: Record<string, Message[]>,
  rootId: string,
  fn: (message: Message) => Message,
): Record<string, Message[]> {
  const existing = threads[rootId];
  if (!existing) return threads;
  const items = mapItems(existing, fn);
  if (items === existing) return threads;
  return { ...threads, [rootId]: items };
}

/**
 * A message with one person's reaction put on or taken off.
 *
 * Pure, and idempotent in both directions: adding an id already under the emoji, or
 * removing one that is not there, returns the *very message it was handed*. That
 * identity is not a nicety — `mapItems` reads it to leave the array alone, which is
 * what stops an open list re-rendering for an event that changed nothing.
 *
 * Both halves of a reaction go through here: `toggleReaction` applies it at click time
 * and the socket's confirming frame applies it again a moment later, so idempotency is
 * one function's property rather than a rule two call sites have to remember. An emoji
 * nobody is left under loses its chip.
 */
export function withReaction(
  message: Message,
  emoji: string,
  userId: string,
  present: boolean,
): Message {
  const index = message.reactions.findIndex((r) => r.emoji === emoji);
  // `noUncheckedIndexedAccess`, so this is already `Reaction | undefined` and `undefined`
  // is exactly the `index === -1` case.
  const existing = message.reactions[index];
  if ((existing?.userIds.includes(userId) ?? false) === present) return message;

  const reactions = message.reactions.slice();
  if (!existing) {
    reactions.push({ emoji, userIds: [userId] });
  } else if (present) {
    reactions[index] = { emoji, userIds: [...existing.userIds, userId] };
  } else {
    const userIds = existing.userIds.filter((id) => id !== userId);
    if (userIds.length === 0) reactions.splice(index, 1);
    else reactions[index] = { emoji, userIds };
  }
  return { ...message, reactions };
}

/**
 * `withReaction` in both places a message can be on screen at once.
 *
 * The target says which thread the message is in, so one thread list is touched rather
 * than every open one; a root's reactions live in its own list as well as the channel's,
 * which is why both maps are walked either way.
 */
export function reacted(
  state: State,
  target: { id: string; channelId: string; threadRootId: string | null },
  emoji: string,
  userId: string,
  present: boolean,
): Pick<State, "messages" | "threads"> {
  const apply = (message: Message): Message =>
    message.id === target.id
      ? withReaction(message, emoji, userId, present)
      : message;
  return {
    messages: mapChannel(state.messages, target.channelId, apply),
    threads: mapThread(state.threads, target.threadRootId ?? target.id, apply),
  };
}

export function setOutbox(
  set: Parameters<StateCreator<State>>[0],
  get: () => State,
  updater: (
    outbox: Record<string, LocalOutboxEntry>,
  ) => Record<string, LocalOutboxEntry>,
): void {
  let nextOutbox: Record<string, LocalOutboxEntry> = {};
  set((state) => {
    nextOutbox = updater(state.outbox);
    return withProjectedOutbox(state, nextOutbox);
  });
  persistOutbox(nextOutbox);
}

export function withProjectedOutbox(
  state: State,
  outbox: Record<string, LocalOutboxEntry>,
): Pick<State, "outbox" | "messages" | "threads"> {
  // Only the places whose entries changed are re-overlaid. Every other channel and
  // thread keeps its `items` reference, which is what keeps them from re-rendering
  // because somebody queued a message somewhere else.
  const channels = new Set<string>();
  const threads = new Set<string>();
  const before = state.outbox;
  for (const key of new Set([...Object.keys(before), ...Object.keys(outbox)])) {
    const was = before[key];
    const now = outbox[key];
    if (was === now) continue;
    for (const entry of [was, now]) {
      if (!entry) continue;
      if (entry.threadRootId === null) channels.add(entry.channelId);
      else threads.add(entry.threadRootId);
    }
  }
  if (channels.size === 0 && threads.size === 0) {
    return { outbox, messages: state.messages, threads: state.threads };
  }
  const queued = sortOutbox(outbox);
  const messages = { ...state.messages };
  for (const channelId of channels) {
    const list = messages[channelId];
    if (!list?.loaded) continue;
    messages[channelId] = {
      ...list,
      items: overlayChannelOutbox(state.currentUser, queued, channelId, list.items),
    };
  }
  const threadLists = { ...state.threads };
  for (const rootId of threads) {
    const items = threadLists[rootId];
    if (!items) continue;
    threadLists[rootId] = overlayThreadOutbox(
      state.currentUser,
      queued,
      rootId,
      items,
    );
  }
  return { outbox, messages, threads: threadLists };
}

export function overlayChannelOutbox(
  currentUser: CurrentUser | null,
  queued: LocalOutboxEntry[],
  channelId: string,
  items: Message[],
): Message[] {
  if (!currentUser) return stripPending(items);
  let next = stripPending(items);
  for (const entry of queued) {
    if (entry.channelId === channelId && entry.threadRootId === null) {
      next = upsert(next, materializeOutboxMessage(entry, currentUser.id));
    }
  }
  return next;
}

export function overlayThreadOutbox(
  currentUser: CurrentUser | null,
  queued: LocalOutboxEntry[],
  rootId: string,
  items: Message[],
): Message[] {
  if (!currentUser) return stripPending(items);
  let next = stripPending(items);
  for (const entry of queued) {
    if (entry.threadRootId === rootId) {
      next = upsert(next, materializeOutboxMessage(entry, currentUser.id));
    }
  }
  return next;
}

export function stripPending(items: Message[]): Message[] {
  return items.filter((message) => !message.id.startsWith("pending-"));
}

/**
 * The `clientMsgId`s this tab has sent, so the frame for one is known for the echo of a
 * send rather than a message arriving. The author cannot answer that — the same person
 * sends from a phone and a laptop — and the outbox cannot either, because the response
 * that empties it very often lands before the frame does.
 *
 * Kept to the last few hundred: a frame comes a moment after its send, so anything
 * older than that is long past needing an answer, and a long session should not keep
 * every id it ever sent.
 */
export const sentHere = new Set<string>();

const SENT_HERE_LIMIT = 256;

export function rememberSent(clientMsgId: string): void {
  sentHere.add(clientMsgId);
  if (sentHere.size > SENT_HERE_LIMIT) {
    const oldest = sentHere.values().next().value;
    if (oldest !== undefined) sentHere.delete(oldest);
  }
}

/** Whether `id` is already a row in this id-sorted list. */
function holds(items: Message[], id: string): boolean {
  return items[positionOf(items, id)]?.id === id;
}

/**
 * Whether a live message lands as a new row in the conversation on screen: the open
 * thread, or the channel you are in once its history has loaded. A copy of a message
 * that is already there — a replay, the socket repeating what a command's response
 * already applied — is not an arrival, and marking it would replay the entrance on a row
 * somebody may be reading.
 */
export function arrivesInView(state: State, message: Message): boolean {
  if (message.threadRootId && message.threadRootId === state.activeThreadRootId) {
    const thread = state.threads[message.threadRootId];
    if (thread && !holds(thread, message.id)) return true;
  }
  if (inChannelHistory(message) && message.channelId === state.activeChannelId) {
    const list = state.messages[message.channelId];
    return Boolean(list?.loaded) && !holds(list?.items ?? [], message.id);
  }
  return false;
}

/**
 * Mark a message as arriving, and forget the mark later whether or not a row used it.
 *
 * `FALLBACK_MS` is the floor `usePresence` puts under an exit, and it is the same
 * promise here: longer than any entrance in the stylesheet, short enough that a mark
 * cannot outlive the moment it was about. A row that was scrolled out of reach, or a
 * message that landed in a window the list then replaced, never consumes its mark — and
 * without the timer, it would play its entrance whenever that row finally mounted.
 */
export function markFresh(
  set: Parameters<StateCreator<State>>[0],
  get: () => State,
  messageId: string,
  began: number | null,
): void {
  set((s) => ({ freshMessages: new Map(s.freshMessages).set(messageId, began) }));
  setTimeout(() => get().settleFresh(messageId), FALLBACK_MS);
}

/** Hand a mark from the pending row to the server's copy of it, start time and all. */
export function moveFresh(
  set: Parameters<StateCreator<State>>[0],
  get: () => State,
  from: string,
  to: string,
): void {
  const fresh = get().freshMessages;
  if (!fresh.has(from)) return;
  const began = fresh.get(from) ?? null;
  get().settleFresh(from);
  markFresh(set, get, to, began);
}

/** Wire the socket into the store once, at app start. */
