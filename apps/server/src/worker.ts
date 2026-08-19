/**
 * Background worker.
 *
 * Same image as the API, different entrypoint. It consumes the queue the send path
 * writes to, so a slow push provider or a hung unfurl can never delay a message.
 */

import { Worker } from 'bullmq';
import { config } from './config.ts';
import { QUEUE_NAME, type JobName, type JobPayloads } from './lib/queue.ts';
import { closePool, query } from './db/pool.ts';
import { closeRedis } from './lib/redis.ts';
import { handleNotify } from './jobs/notify.ts';
import { handleUnfurl } from './jobs/unfurl.ts';
import { deleteObject } from './lib/storage.ts';
import * as hub from './realtime/hub.ts';

/** Unattached uploads are swept after this long. */
const ORPHAN_AGE_HOURS = 24;

const worker = new Worker<JobPayloads[JobName], void, JobName>(
  QUEUE_NAME,
  async (job) => {
    switch (job.name) {
      case 'notify':
        await handleNotify((job.data as JobPayloads['notify']).messageId);
        break;
      case 'unfurl':
        await handleUnfurl((job.data as JobPayloads['unfurl']).messageId);
        break;
      case 'sweep-orphans':
        await sweepOrphans();
        break;
      default:
        console.warn({ job: job.name }, 'unknown job');
    }
  },
  { connection: { url: config.REDIS_URL }, concurrency: 8 },
);

worker.on('failed', (job, err) => {
  console.error({ job: job?.name, id: job?.id, err: err.message }, 'job failed');
});

/** Uploads that were started but never attached to a message. */
async function sweepOrphans(): Promise<void> {
  const rows = await query<{ id: string; object_key: string }>(
    `DELETE FROM attachments
      WHERE message_id IS NULL
        AND created_at < now() - ($1 || ' hours')::interval
      RETURNING id, object_key`,
    [String(ORPHAN_AGE_HOURS)],
  );
  for (const row of rows) {
    await deleteObject(row.object_key).catch(() => {});
  }
  if (rows.length > 0) console.log(`swept ${rows.length} orphaned uploads`);
}

async function start(): Promise<void> {
  // The worker broadcasts too (read-state updates from notify), so it needs the bridge.
  await hub.startRedisBridge();
  console.log('worker ready');
}

const shutdown = async () => {
  await worker.close();
  await Promise.allSettled([closeRedis(), closePool()]);
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
