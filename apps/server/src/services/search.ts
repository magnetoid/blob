/**
 * Message search.
 *
 * Postgres full-text search, deliberately behind one interface so swapping in
 * Meilisearch later touches this file only. At <100 users it will never need to be.
 *
 * The join against channel_members is the security boundary — it is what stops
 * private-channel content appearing in someone else's results. It is not optional,
 * and there is a test that fails if it is removed.
 */

import type { Message } from '@blob/shared';
import { query } from '../db/pool.ts';
import { MESSAGE_SELECT, toMessage, type MessageRow } from './serialize.ts';

export interface SearchParams {
  workspaceId: string;
  userId: string;
  q: string;
  from?: string;
  channelId?: string;
  before?: string;
  after?: string;
  has?: 'link' | 'file';
  limit: number;
}

export interface SearchResult {
  messages: Message[];
  /** Channel id per result, so the UI can label where each hit came from. */
  total: number;
}

export async function search(params: SearchParams): Promise<SearchResult> {
  const rows = await query<MessageRow & { total: number }>(
    `WITH hits AS (
       SELECT m.id
         FROM messages m
         JOIN channel_members cm
           ON cm.channel_id = m.channel_id AND cm.user_id = $2   -- security boundary
        WHERE m.workspace_id = $1
          AND m.deleted_at IS NULL
          AND m.search_tsv @@ websearch_to_tsquery('english', $3)
          AND ($4::uuid IS NULL OR m.author_id = $4)
          AND ($5::uuid IS NULL OR m.channel_id = $5)
          AND ($6::timestamptz IS NULL OR m.created_at < $6)
          AND ($7::timestamptz IS NULL OR m.created_at > $7)
          AND ($8::text IS NULL
               OR ($8 = 'link' AND m.body ~* 'https?://')
               OR ($8 = 'file' AND EXISTS (
                     SELECT 1 FROM attachments a WHERE a.message_id = m.id)))
        ORDER BY ts_rank(m.search_tsv, websearch_to_tsquery('english', $3)) DESC, m.id DESC
        LIMIT $9
     )
     SELECT ${MESSAGE_SELECT}, (SELECT count(*) FROM hits)::int AS total
       FROM messages m
       JOIN hits ON hits.id = m.id
      ORDER BY m.id DESC`,
    [
      params.workspaceId,
      params.userId,
      params.q,
      params.from ?? null,
      params.channelId ?? null,
      params.before ?? null,
      params.after ?? null,
      params.has ?? null,
      params.limit,
    ],
  );

  return {
    messages: rows.map(toMessage),
    total: rows[0]?.total ?? 0,
  };
}

/**
 * Parse Slack-style modifiers out of a raw query string.
 *
 * `from:@ana in:#eng has:link before:2026-01-01 deploy failed`
 * → { from: 'ana', in: 'eng', has: 'link', before: …, text: 'deploy failed' }
 */
export interface ParsedQuery {
  text: string;
  from?: string;
  in?: string;
  has?: 'link' | 'file';
  before?: string;
  after?: string;
}

export function parseQuery(raw: string): ParsedQuery {
  const parsed: ParsedQuery = { text: '' };
  const words: string[] = [];

  for (const token of raw.split(/\s+/)) {
    const [key, ...rest] = token.split(':');
    const value = rest.join(':');
    if (!value) {
      if (token) words.push(token);
      continue;
    }
    switch (key) {
      case 'from':
        parsed.from = value.replace(/^@/, '');
        break;
      case 'in':
        parsed.in = value.replace(/^#/, '');
        break;
      case 'has':
        if (value === 'link' || value === 'file') parsed.has = value;
        break;
      case 'before':
        parsed.before = value;
        break;
      case 'after':
        parsed.after = value;
        break;
      default:
        words.push(token);
    }
  }

  parsed.text = words.join(' ').trim();
  return parsed;
}
