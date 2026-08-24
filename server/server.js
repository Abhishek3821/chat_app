import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import { primeTenantOrigins } from './utils/tenantOrigins.js';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { Server as SocketServer } from 'socket.io';
import mongoose from 'mongoose';

import { connectDB } from './config/db.js';
import { ensureWorkspaces } from './utils/workspaceService.js';
import { ensureSuperAdmin, describeSuperAdmin } from './utils/superAdmin.js';
import { resetAllPresence, startPresenceSweeper } from './utils/presence.js';
import { reportIceReadiness } from './utils/iceServers.js';
import apiRoutes from './routes/index.js';
import { notFound, errorHandler } from './middleware/error.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { mongoSanitize } from './middleware/sanitize.js';
import { csrfGuard, isAllowedOrigin, isFirstPartyOrigin, isEmbedTenantOrigin } from './middleware/csrf.js';
import { serveUpload } from './controllers/mediaController.js';
import { verifyEmailTransport, closeEmailTransport, isEmailConfigured } from './utils/sendEmail.js';
import { initSocket, getIO } from './socket/index.js';
import { getAdapterPair, redisEnabled } from './utils/redis.js';
import { initQueue } from './utils/queue.js';
import { registerFanoutJobs } from './utils/jobs.js';
import { sweepStaleCalls } from './utils/callService.js';
import { startScheduledDispatcher } from './utils/scheduledDispatcher.js';
import { startPinSweeper } from './utils/pins.js';

const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5290';

/**
 * CORS origin check shared by Express + Socket.IO — delegates to the same
 * allowlist the CSRF guard uses (middleware/csrf.js), so the two never drift.
 * Allows CLIENT_URL + EXTRA_CORS_ORIGINS always, and any localhost/LAN origin
 * in development.
 */
/**
 * Per-request CORS options, because CREDENTIALS must vary by origin tier.
 *
 * Don't THROW on a disallowed origin — that returns a 500 and makes CSRF
 * defense an implicit side-effect of CORS. Declining the headers is enough;
 * csrfGuard is the explicit gate with a clean 403.
 *
 * First-party origins get credentials (the app relies on httpOnly session
 * cookies). Tenant-registered origins do NOT: that list is self-service and
 * effectively attacker-controllable, and granting it cookie access let any
 * signed-up user read a fresh access token out of /auth/refresh in a victim's
 * browser. An embed authenticates with a Bearer user token, which needs no
 * cookies — so withCredentials from a tenant origin is refused by design.
 */
function corsOptions(req, cb) {
  const origin = req.header('Origin');
  // No Origin: curl, server-to-server, same-origin. Nothing to widen.
  if (!origin) return cb(null, { origin: true, credentials: true });
  if (isFirstPartyOrigin(origin)) return cb(null, { origin: true, credentials: true });
  if (isEmbedTenantOrigin(origin)) return cb(null, { origin: true, credentials: false });
  return cb(null, { origin: false, credentials: false });
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
  // Checked via isEmailConfigured() so the SMTP_* aliases and BREVO_API_KEY
  // count — reading EMAIL_HOST alone warned about a perfectly working mailer.
  if (process.env.ENABLE_EMAIL_VERIFICATION === 'true' && !isEmailConfigured()) {
    const msg = 'ENABLE_EMAIL_VERIFICATION=true but no mail transport is configured — signups cannot receive their verification code.';
    if (isProd) console.error(`❌ ${msg} Configure SMTP (EMAIL_*/SMTP_*) or BREVO_API_KEY, or disable verification.`);
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
app.use(cors(corsOptions));
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
app.get('/', (req, res) => res.json({ success: true, message: 'ChatKonect API is running 🚀' }));

// ── Error handling ──────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Socket.IO ───────────────────────────────────────────────────
const io = new SocketServer(server, {
  /* Both origin tiers may open a socket, and credentials stay on here — unlike
     the HTTP layer, the handshake has NO cookie path: it reads the token from
     `handshake.auth.token` (or an Authorization header) and rejects scoped
     tokens outright. So there is no ambient credential for a hostile origin to
     ride, which is what made HTTP cookies the problem. */
  cors: { origin: (origin, cb) => cb(null, isAllowedOrigin(origin)), credentials: true },
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
  // Embedding tenants' registered origins feed the CORS/CSRF allowlist. Primed
  // here so the first cross-origin request isn't the one that pays for the query.
  await primeTenantOrigins();

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

  /* The single super admin, declared in .env and reconciled here. This runs
     AFTER ensureWorkspaces so a freshly created admin lands in a real workspace,
     and on every boot — which is what makes pointing MONGO_URI at an empty
     database self-provisioning instead of a locked-out one. */
  try {
    console.log(describeSuperAdmin(await ensureSuperAdmin()));
  } catch (err) {
    console.warn('⚠️  Super-admin provisioning failed:', err?.message || err);
  }

  // Report SMTP status at boot so "why isn't the OTP email arriving?" is obvious.
  if (process.env.ENABLE_EMAIL_VERIFICATION === 'true') {
    const r = await verifyEmailTransport();
    if (r.ok) console.log('✅ SMTP verified — OTP / verification emails will send.');
    else console.warn(`⚠️  SMTP NOT ready: ${r.reason}\n   → OTP emails will not be delivered until EMAIL_HOST/USER/PASS are set correctly.`);
  }

  /* Presence. Two halves, and both are needed:
     — the RESET, because a process that just started has nobody connected to
       it, so every `isOnline: true` in the database is a leftover from a crash
       or a previous deploy. Without it presence never recovers and everyone
       reads as permanently online.
     — the SWEEPER, which marks anyone who stopped heartbeating offline, so a
       tab left open overnight or a half-open socket doesn't keep them lit. */
  try {
    const cleared = await resetAllPresence();
    if (cleared) console.log(`👤 Presence reset: ${cleared} stale "online" flag(s) cleared from a previous run.`);
  } catch (err) {
    console.warn('⚠️  Presence reset skipped:', err?.message || err);
  }
  /* Relay readiness. WebRTC needs a TURN relay whenever both peers sit behind
     symmetric NAT or CGNAT — mobile carriers, most office networks. Without one
     the call rings, both sides accept, and then there is no media: a failure that
     looks like a bug in the app rather than a missing deployment setting. Say so
     at boot so it is a known state instead of a mystery support ticket. */
  /* Not awaited: verifying a managed provider means an API round trip, and boot
     must not wait on a third party. It logs when it resolves. */
  reportIceReadiness().catch(() => {});

  startPresenceSweeper((userId, lastSeen) => {
    getIO()?.emit('user-offline', { userId, lastSeen });
  });

  // Zombie-call sweeper: closes ringing/live Call records whose clients died
  // without reporting an ending (crash, network loss on both sides).
  setInterval(() => sweepStaleCalls().catch(() => {}), 60_000).unref();

  // Scheduled-message dispatcher. Claims due rows with an atomic compare-and-set,
  // so running several instances behind a load balancer can't double-send.
  startScheduledDispatcher();

  // Pinned messages expire on the schedule their pinner chose. Reads already
  // filter lapsed pins out, so this is about telling open clients on time and
  // keeping the arrays from growing — not about correctness.
  startPinSweeper();

  server.listen(PORT, () => {
    console.log(`\n🚀 ChatKonect API listening on http://localhost:${PORT}`);
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
    closeEmailTransport(); // release pooled SMTP sockets
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
