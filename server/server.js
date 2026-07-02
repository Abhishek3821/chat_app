import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { Server as SocketServer } from 'socket.io';

import { connectDB } from './config/db.js';
import apiRoutes from './routes/index.js';
import { notFound, errorHandler } from './middleware/error.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { mongoSanitize } from './middleware/sanitize.js';
import { serveUpload } from './controllers/mediaController.js';
import { initSocket } from './socket/index.js';

const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5290';
const EXTRA_ORIGINS = (process.env.EXTRA_CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * CORS origin check shared by Express + Socket.IO.
 * - Always allows the configured CLIENT_URL and any EXTRA_CORS_ORIGINS.
 * - In development, also allows any localhost / 127.0.0.1 / LAN-IP origin on
 *   any port, so the dev client works no matter which port it lands on and a
 *   friend on the same Wi-Fi can connect via your machine's LAN IP.
 */
function corsOrigin(origin, cb) {
  if (!origin) return cb(null, true); // curl / server-to-server / same-origin
  if ([CLIENT_URL, ...EXTRA_ORIGINS].includes(origin)) return cb(null, true);
  const isLocalOrLan = /^https?:\/\/(localhost|127\.0\.0\.1|(?:\d{1,3}\.){3}\d{1,3})(:\d+)?$/.test(origin);
  if (process.env.NODE_ENV !== 'production' && isLocalOrLan) return cb(null, true);
  return cb(new Error(`CORS: origin ${origin} is not allowed`));
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
}

const app = express();
app.set('trust proxy', 1); // correct req.ip / Secure cookies behind Render/Vercel/NGINX
const server = http.createServer(app);

// ── Security & parsing middleware ───────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(mongoSanitize);
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));

// ── Uploaded files (authenticated + per-chat access control) ─────
// NOT public static: serveUpload requires a valid token and, for chat
// attachments, membership of the owning conversation.
app.get('/uploads/:filename', serveUpload);

// ── API ─────────────────────────────────────────────────────────
app.use('/api', apiLimiter, apiRoutes);
app.get('/', (req, res) => res.json({ success: true, message: 'ChatConnect API is running 🚀' }));

// ── Error handling ──────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Socket.IO ───────────────────────────────────────────────────
const io = new SocketServer(server, {
  cors: { origin: corsOrigin, credentials: true },
});
initSocket(io);
app.set('io', io);

// ── Boot ────────────────────────────────────────────────────────
async function start() {
  validateEnv();
  await connectDB();
  server.listen(PORT, () => {
    console.log(`\n🚀 ChatConnect API listening on http://localhost:${PORT}`);
    console.log(`🔌 Socket.IO ready • CORS origin: ${CLIENT_URL}\n`);
  });
}

start();

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err?.message || err);
});
