/**
 * Demo data.
 *
 * Creates a workspace with a handful of people, channels and a realistic conversation
 * so the app has something to show on first run. Safe to re-run: it clears first.
 */

import { hashPassword } from '../lib/auth.ts';
import { newId } from '../lib/ids.ts';
import { pool, query, transaction } from '../db/pool.ts';
import { migrate } from './migrate.ts';
import * as messageService from '../services/messages.ts';

const PASSWORD = 'correct-horse-battery';

const PEOPLE = [
  { name: 'Ana Petrov', email: 'ana@example.com', title: 'Engineering lead', role: 'owner' },
  { name: 'Marko Ilic', email: 'marko@example.com', title: 'Product', role: 'admin' },
  { name: 'Devin Cole', email: 'devin@example.com', title: 'Design', role: 'member' },
  { name: 'Priya Raman', email: 'priya@example.com', title: 'Infrastructure', role: 'member' },
] as const;

const CHANNELS = [
  { name: 'general', topic: 'Company-wide announcements and anything without a home yet' },
  { name: 'random', topic: 'Non-work chatter' },
  { name: 'engineering', topic: 'Builds, deploys, and code review' },
  { name: 'design', topic: 'Work in progress, critique, and design decisions' },
] as const;

/** [channel, author index, body, optional thread replies] */
const CONVERSATION: [string, number, string, string[]?][] = [
  ['general', 0, 'Morning. Standup notes are up — I moved the two carryover items into #engineering so they stop getting lost in here.'],
  ['general', 1, 'Thanks. I added the customer call summary underneath, worth a skim before Thursday.'],
  ['general', 2, 'Reminder that the office is closed Friday. @Ana Petrov do we still want the retro that afternoon?', ['Let\'s move it to Monday morning.', 'Monday works. I\'ll send a new invite.']],
  ['engineering', 3, 'Deploy went out at 09:40. Error rate is flat, p99 down about 12ms — the index on `(channel_id, id DESC)` is doing what we hoped.'],
  ['engineering', 0, 'Nice. That was the one keeping history pagination honest.\n\n```sql\nSELECT * FROM messages\n WHERE channel_id = $1 AND id < $2\n ORDER BY id DESC LIMIT 50;\n```'],
  ['engineering', 1, 'Do we have a number for how far back search stays fast?', ['Tested to about 2M messages on a laptop — 30ms cold. We are nowhere near needing Meilisearch.', 'Good. Filing that under "problems for next year".']],
  ['design', 2, 'Pushed the paper palette to the shared file. The green reads better against the warm neutrals than the blue did.'],
  ['design', 1, 'Agreed, it stops the whole thing looking like every other chat app.'],
  ['random', 3, 'Someone has left an extremely good sourdough in the kitchen and I need to know who to thank.'],
  ['random', 2, 'That would be me. There is more.'],
];

async function seed(): Promise<void> {
  await migrate(() => {});

  console.log('clearing existing data…');
  await query(`
    TRUNCATE workspaces, users, sessions, invites, password_resets, channels,
             channel_members, messages, reactions, attachments, custom_emoji,
             read_states, thread_subscriptions, push_subscriptions, webhooks
    RESTART IDENTITY CASCADE
  `);

  const workspaceId = newId();
  const passwordHash = await hashPassword(PASSWORD);
  const userIds: string[] = [];
  const channelIds: Record<string, string> = {};

  await transaction(async (client) => {
    await client.query('INSERT INTO workspaces (id, name, slug) VALUES ($1, $2, $3)', [
      workspaceId,
      'Northwind',
      'northwind',
    ]);

    for (const person of PEOPLE) {
      const id = newId();
      userIds.push(id);
      await client.query(
        `INSERT INTO users (id, workspace_id, email, password_hash, display_name, title, role, timezone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Europe/Belgrade')`,
        [id, workspaceId, person.email, passwordHash, person.name, person.title, person.role],
      );
    }

    for (const channel of CHANNELS) {
      const id = newId();
      channelIds[channel.name] = id;
      await client.query(
        `INSERT INTO channels (id, workspace_id, kind, name, topic, created_by)
         VALUES ($1, $2, 'public', $3, $4, $5)`,
        [id, workspaceId, channel.name, channel.topic, userIds[0]],
      );
      await client.query(
        `INSERT INTO channel_members (channel_id, user_id)
         SELECT $1, unnest($2::uuid[])`,
        [id, userIds],
      );
    }
  });

  console.log('writing conversation…');
  for (const [channelName, authorIndex, body, replies] of CONVERSATION) {
    const channelId = channelIds[channelName];
    const authorId = userIds[authorIndex];
    if (!channelId || !authorId) continue;

    const { message } = await messageService.send({
      workspaceId,
      channelId,
      authorId,
      body,
      clientMsgId: newId(),
    });

    for (const [index, reply] of (replies ?? []).entries()) {
      const replyAuthor = userIds[(authorIndex + index + 1) % userIds.length];
      if (!replyAuthor) continue;
      await messageService.send({
        workspaceId,
        channelId,
        authorId: replyAuthor,
        body: reply,
        clientMsgId: newId(),
        threadRootId: message.id,
      });
    }
  }

  // A couple of reactions so the UI isn't uniformly bare.
  const firstMessage = await query<{ id: string }>(
    'SELECT id FROM messages WHERE thread_root_id IS NULL ORDER BY id LIMIT 1',
  );
  if (firstMessage[0]) {
    for (const emoji of ['👍', '🎉']) {
      for (const userId of userIds.slice(1, 3)) {
        await messageService.addReaction(firstMessage[0].id, userId, emoji);
      }
    }
  }

  console.log('\nSeeded the Northwind workspace.');
  console.log(`  Sign in as any of: ${PEOPLE.map((p) => p.email).join(', ')}`);
  console.log(`  Password: ${PASSWORD}\n`);
}

seed()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
