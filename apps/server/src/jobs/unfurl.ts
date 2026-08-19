/**
 * Link previews.
 *
 * Fetches the first URL in a message and extracts its OpenGraph tags. Deliberately
 * defensive: an unfurl is a nice-to-have that must never hang the queue or become an
 * SSRF vector, so private address ranges are refused and the fetch is capped hard.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { query, queryOne } from '../db/pool.ts';
import * as messages from '../services/messages.ts';
import * as hub from '../realtime/hub.ts';

const FETCH_TIMEOUT_MS = 5_000;
const MAX_BYTES = 512 * 1024;

export interface Unfurl {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
}

export async function handleUnfurl(messageId: string): Promise<void> {
  const message = await queryOne<{ body: string; channel_id: string }>(
    'SELECT body, channel_id FROM messages WHERE id = $1 AND deleted_at IS NULL',
    [messageId],
  );
  if (!message) return;

  const url = firstUrl(message.body);
  if (!url) return;

  const unfurl = await fetchUnfurl(url);
  if (!unfurl?.title) return;

  await query('UPDATE messages SET link_preview = $2 WHERE id = $1', [
    messageId,
    JSON.stringify(unfurl),
  ]);

  // Tell open clients to re-render the message with its preview attached.
  const updated = await messages.byId(messageId);
  if (updated) {
    hub.toChannel(message.channel_id, { t: 'message.updated', message: updated });
  }
}

export function firstUrl(body: string): string | null {
  const match = body.match(/https?:\/\/[^\s<>"')]+/);
  return match?.[0] ?? null;
}

export async function fetchUnfurl(rawUrl: string): Promise<Unfurl | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (await isPrivateHost(url.hostname)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'blob-unfurl/1.0', accept: 'text/html' },
    });
    if (!res.ok || !res.headers.get('content-type')?.includes('text/html')) return null;

    const html = await readCapped(res, MAX_BYTES);
    return {
      url: url.toString(),
      title: meta(html, 'og:title') ?? titleTag(html),
      description: meta(html, 'og:description') ?? meta(html, 'description'),
      imageUrl: meta(html, 'og:image'),
      siteName: meta(html, 'og:site_name'),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Refuse loopback, link-local and RFC1918 targets — this runs inside our network. */
async function isPrivateHost(hostname: string): Promise<boolean> {
  const addresses: string[] = [];
  if (isIP(hostname)) {
    addresses.push(hostname);
  } else {
    try {
      const resolved = await lookup(hostname, { all: true });
      addresses.push(...resolved.map((r) => r.address));
    } catch {
      return true;
    }
  }
  return addresses.some(isPrivateAddress);
}

export function isPrivateAddress(address: string): boolean {
  if (address === '::1' || address.startsWith('fc') || address.startsWith('fd')) return true;
  if (address.startsWith('fe80')) return true;
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  void reader.cancel();
  return new TextDecoder().decode(concat(chunks, Math.min(total, maxBytes)));
}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    const room = length - offset;
    if (room <= 0) break;
    out.set(chunk.subarray(0, room), offset);
    offset += Math.min(chunk.length, room);
  }
  return out;
}

function meta(html: string, property: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`, 'i'),
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match?.[1]) return decodeEntities(match[1]).slice(0, 300);
  }
  return null;
}

function titleTag(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match?.[1] ? decodeEntities(match[1]).trim().slice(0, 300) : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
