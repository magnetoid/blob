/**
 * Background jobs.
 *
 * Anything that must not slow down a message send — push delivery, link unfurls,
 * thumbnails, digests — is enqueued after the transaction commits and handled by the
 * worker process.
 */

import { Queue, type JobsOptions } from 'bullmq';
import { config } from '../config.ts';

const connection = { url: config.REDIS_URL };

export const QUEUE_NAME = 'blob-jobs';

export interface JobPayloads {
  notify: { messageId: string };
  unfurl: { messageId: string };
  thumbnail: { attachmentId: string };
  'sweep-orphans': Record<string, never>;
}

export type JobName = keyof JobPayloads;

const defaultOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: 500,
  removeOnFail: 1_000,
};

export const jobs = new Queue<JobPayloads[JobName], void, JobName>(QUEUE_NAME, {
  connection,
  defaultJobOptions: defaultOptions,
});

/** Enqueue and swallow failures: a lost unfurl must never fail a message send. */
export function enqueue<N extends JobName>(
  name: N,
  data: JobPayloads[N],
  options?: JobsOptions,
): void {
  void jobs.add(name, data, options).catch((err) => {
    console.error({ err, job: name }, 'failed to enqueue job');
  });
}

export async function closeQueue(): Promise<void> {
  await jobs.close();
}
