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
let worker = null;

/** Graceful shutdown: let in-flight jobs finish so they aren't re-run as "stalled". */
export async function closeQueue() {
  await Promise.allSettled([worker?.close(), queue?.close()]);
  worker = null;
  queue = null;
}

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
  /* Producer: fail fast. With an offline queue, queue.add() never rejects while
     Redis is down — the inline fallback in enqueue() was unreachable and every
     job piled up in memory. BullMQ's docs recommend enableOfflineQueue:false on
     Queue connections for exactly this. */
  const producer = new Redis(process.env.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
  producer.on('error', (e) => console.warn('⚠️  Redis(queue):', e.message));
  queue = new Queue('fanout', { connection: producer });
  queue.on('error', (e) => console.warn('⚠️  queue:', e.message));
  // Worker: BullMQ requires maxRetriesPerRequest: null; it waits for Redis to return.
  const workerConn = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  workerConn.on('error', (e) => console.warn('⚠️  Redis(worker):', e.message));
  worker = new Worker('fanout', (job) => runJob(job.name, job.data), {
    connection: workerConn,
    concurrency: 10,
  });
  worker.on('error', (e) => console.warn('⚠️  worker:', e.message));
  worker.on('failed', (job, err) => console.warn(`⚠️  job "${job?.name}" failed:`, err?.message));
  console.log('✅ BullMQ worker ready (queue: fanout).');
}
