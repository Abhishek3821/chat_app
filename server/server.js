import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { Server as SocketServer } from 'socket.io';
import mongoose from 'mongoose';

import { connectDB } from './config/db.js';
import { ensureWorkspaces } from './utils/workspaceService.js';
import apiRoutes from './routes/index.js';
import { notFound, errorHandler } from './middleware/error.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { mongoSanitize } from './middleware/sanitize.js';
import { csrfGuard, isAllowedOrigin } from './middleware/csrf.js';
import { serveUpload } from './controllers/mediaController.js';
import { verifyEmailTransport } from './utils/sendEmail.js';
import { initSocket } from './socket/index.js';
import { getAdapterPair, redisEnabled } from './utils/redis.js';
import { initQueue } from './utils/queue.js';
import { registerFanoutJobs } from './utils/jobs.js';

const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5290';

/**
 * CORS origin check shared by Express + Socket.IO — delegates to the same
 * allowlist the CSRF guard uses (middleware/csrf.js), so the two never drift.
 * Allows CLIENT_URL + EXTRA_CORS_ORIGINS always, and any localhost/LAN origin
 * in development.
 */
function corsOrigin(origin, cb) {
  // Don't THROW on a disallowed origin — that returns a 500 and makes CSRF
  // defense an implicit side-effect of CORS. Instead just decline CORS headers
  // (the browser then can't read the response); csrfGuard is the explicit gate
  // that blocks cross-site state-changing requests with a clean 403.
  return cb(null, isAllowedOrigin(origin));
}

/**
 * Fail fast on an insecure production config, and warn loudly in development so
 * nobody ships with dev defaults. A weak/missing JWT_SECRET means forgeable
 * sessions; a non-production NODE_ENV means permissive CORS + non-Secure cookies
 * + exposed dev OTPs.
 */
function validateEnv() {
  const isProd = process.env.NODE_ENV === 'production';
  const secret = process.env.JWT_SECRET || '';
  const weakSecret = secret.length < 32 || secret === 'change_this_to_a_long_random_string';
  if (weakSecret) {
    const msg = 'JWT_SECRET is missing or weak — use a random string of at least 32 characters.';
    if (isProd) {
      console.error(`❌ ${msg} Refusing to start in production.`);
      process.exit(1);
    }
    console.warn(`⚠️  ${msg}`);
  }
  if (!isProd) {
    console.warn('⚠️  NODE_ENV is not "production": CORS is permissive, cookies are not Secure, and dev OTPs may be returned in API responses. Set NODE_ENV=production before deploying.');
  }
  // Email verification with no mail transport = users can never receive their
  // code (in production the OTP is not returned in the response). Surface it.
  if (process.env.ENABLE_EMAIL_VERIFICATION === 'true' && !process.env.EMAIL_HOST) {
    const msg = 'ENABLE_EMAIL_VERIFICATION=true but no EMAIL_HOST is configured — signups cannot receive their verification code.';
    if (isProd) console.error(`❌ ${msg} Configure SMTP (EMAIL_*) or disable verification.`);
    else console.warn(`⚠️  ${msg} (dev: the code is returned in the API response instead.)`);
  }
}

const app = express();
app.set('trust proxy', 1); // correct req.ip / Secure cookies behind Render/Vercel/NGINX
const server = http.createServer(app);

// ── Security & parsing middleware ───────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
// Gzip responses (JSON chat/message payloads compress ~5–8×, cutting transfer
// time on every API call). The filter auto-skips already-compressed media.
app.use(compression());
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(mongoSanitize);
// Access logs in every environment: human-friendly in dev, Apache "combined"
// in production (Render captures stdout — this is the request audit trail).
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Uploaded files (authenticated + per-chat access control) ─────
// NOT public static: serveUpload requires a valid token and, for chat
// attachments, membership of the owning conversation.
app.get('/uploads/:filename', serveUpload);

// ── API ─────────────────────────────────────────────────────────
// csrfGuard rejects cross-site cookie-borne mutations (Origin verification).
app.use('/api', apiLimiter, csrfGuard, apiRoutes);
app.get('/', (req, res) => res.json({ success: true, message: 'ChatConnect API is running 🚀' }));

// ── Error handling ──────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Socket.IO ───────────────────────────────────────────────────
const io = new SocketServer(server, {
  cors: { origin: corsOrigin, credentials: true },
});
// Attach the Redis adapter when REDIS_URL is set, so message/presence fan-out
// works across a load-balanced fleet of instances. Without it, Socket.IO runs
// single-instance exactly as before.
let hasAdapter = false;
const adapterPair = getAdapterPair();
if (adapterPair) {
  const { createAdapter } = await import('@socket.io/redis-adapter');
  io.adapter(createAdapter(adapterPair.pub, adapterPair.sub));
  hasAdapter = true;
  console.log('✅ Socket.IO Redis adapter attached (horizontal scaling enabled).');
}
initSocket(io, { hasAdapter });
app.set('io', io);

// ── Boot ────────────────────────────────────────────────────────
async function start() {
  validateEnv();
  await connectDB();

  // Background jobs (notification fan-out, push delivery). Runs on a BullMQ
  // worker when REDIS_URL is set, else inline in this process.
  registerFanoutJobs();
  await initQueue();

  // Multi-tenancy: attach any pre-existing users/chats to a default workspace
  // (idempotent — only touches docs created before workspaces existed).
  try {
    const summary = await ensureWorkspaces();
    if (summary.migrated) {
      console.log(`🏢 Workspace migration: moved ${summary.users} user(s) + ${summary.chats} chat(s) into "${summary.workspace}".`);
    }
  } catch (err) {
    console.warn('⚠️  Workspace migration skipped:', err?.message || err);
  }

  // Report SMTP status at boot so "why isn't the OTP email arriving?" is obvious.
  if (process.env.ENABLE_EMAIL_VERIFICATION === 'true') {
    const r = await verifyEmailTransport();
    if (r.ok) console.log('✅ SMTP verified — OTP / verification emails will send.');
    else console.warn(`⚠️  SMTP NOT ready: ${r.reason}\n   → OTP emails will not be delivered until EMAIL_HOST/USER/PASS are set correctly.`);
  }

  server.listen(PORT, () => {
    console.log(`\n🚀 ChatConnect API listening on http://localhost:${PORT}`);
    console.log(`🔌 Socket.IO ready • CORS origin: ${CLIENT_URL}\n`);
  });
}

start();

// ── Lifecycle ───────────────────────────────────────────────────
// Graceful shutdown: on deploys/restarts the platform sends SIGTERM. Stop
// accepting new work, tell connected clients, close DB handles, then exit —
// so in-flight requests aren't killed mid-write.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down gracefully…`);
  // Hard deadline: never hang a deploy waiting on a stuck connection.
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  try {
    await new Promise((resolve) => server.close(resolve)); // stop new HTTP conns
    io.close(); // disconnect sockets (clients auto-reconnect to the new instance)
    await mongoose.connection.close();
  } catch (err) {
    console.error('Shutdown error:', err?.message || err);
  }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err?.message || err);
});
process.on('uncaughtException', (err) => {
  // State is undefined after an uncaught throw — log and let the platform
  // restart a clean process rather than limping on.
  console.error('Uncaught exception:', err);
  shutdown('uncaughtException');
});
