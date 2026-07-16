import Redis from 'ioredis';
import { redisEnabled } from './redis.js';

/**
 * Background-job layer with a transparent fallback.
 *   • REDIS_URL set  → BullMQ: durable, retried, processed off the request path.
 *   • REDIS_URL unset → the job runs inline, fire-and-forget, in this process.
 * Either way callers just `enqueue(name, data)` and move on — the request never
 * blocks on notification fan-out, push delivery or email.
 */
const handlers = new Map();
let queue = null;

/** Register a processor for a job name. Call before initQueue(). */
export function registerJob(name, handler) {
  handlers.set(name, handler);
}

async function runJob(name, data) {
  const fn = handlers.get(name);
  if (!fn) return;
  await fn(data);
}

export async function enqueue(name, data = {}) {
  if (queue) {
    try {
      await queue.add(name, data, {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });
      return;
    } catch (e) {
      console.warn('⚠️  enqueue failed, running inline:', e.message);
    }
  }
  // Inline fallback — never let a failed side-effect bubble into the request.
  runJob(name, data).catch((e) => console.warn(`⚠️  job "${name}" failed:`, e.message));
}

/** Wire up the BullMQ queue + worker. No-op (inline mode) without Redis. */
export async function initQueue() {
  if (!redisEnabled()) {
    console.log('ℹ️  Jobs run inline (set REDIS_URL to offload them to a BullMQ worker).');
    return;
  }
  const { Queue, Worker } = await import('bullmq');
  // BullMQ requires maxRetriesPerRequest: null on its connections.
  const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  queue = new Queue('fanout', { connection });
  const worker = new Worker('fanout', (job) => runJob(job.name, job.data), {
    connection: connection.duplicate(),
    concurrency: 10,
  });
  worker.on('failed', (job, err) => console.warn(`⚠️  job "${job?.name}" failed:`, err?.message));
  console.log('✅ BullMQ worker ready (queue: fanout).');
}
