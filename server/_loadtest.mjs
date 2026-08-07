process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = 'x'.repeat(48);
process.env.CLIENT_URL = 'http://localhost:5290';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import http from 'http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import User from './models/User.js';
import Session from './models/Session.js';
import { mongoSanitize } from './middleware/sanitize.js';
import { csrfGuard } from './middleware/csrf.js';
import { apiLimiter } from './middleware/rateLimit.js';

const oid = () => new mongoose.Types.ObjectId();
const arr = (n) => Array.from({ length: n }, oid);
const N_CONTACTS = Number(process.env.NC || 50);
const rawUser = {
  _id: oid(), name: 'Test User', username: 'testuser', email: 't@e.com', avatar: '',
  bio: 'hi', phone: '+15550001', role: 'user', accountStatus: 'active',
  workspace: oid(), workspaceRole: 'member', isVerified: true, tokenVersion: 0,
  twoStepEnabled: false, isOnline: true, lastSeen: new Date(), presenceState: 'available',
  contacts: arr(N_CONTACTS), favorites: arr(5), blockedUsers: [], pinnedChats: arr(3),
  archivedChats: arr(2), mutedChats: [], lockedChats: [],
  privacy: { lastSeen:'everyone',profilePhoto:'everyone',about:'everyone',status:'contacts',readReceipts:true,groupAddPermission:'everyone',onlineStatus:'everyone' },
  settings: { theme:'dark', accent:'teal', notifications:{messages:true,groups:true,calls:true,meetings:true,sound:true}, enterToSend:true },
  createdAt: new Date(), updatedAt: new Date(),
};
const rawUserJson = JSON.stringify(rawUser);
const sid = oid();
const rawSession = { _id: sid, user: rawUser._id, revokedAt: null, expiresAt: new Date(Date.now()+9e8), lastActiveAt: new Date() };
const token = jwt.sign({ id: String(rawUser._id), role: 'user', tokenVersion: 0, sid: String(sid), type: 'access' }, process.env.JWT_SECRET, { algorithm:'HS256', expiresIn:'1h' });

// A ~40KB chat-list-ish payload to exercise compression like GET /chats does
const chatList = Array.from({ length: 40 }, (_, i) => ({
  _id: String(oid()), isGroup: false, name: 'Chat ' + i, updatedAt: new Date(),
  participants: [{ user: { _id: String(oid()), name: 'Person '+i, username:'p'+i, avatar:'', isOnline:true, lastSeen:new Date(), presenceState:'available' } }],
  lastMessage: { _id: String(oid()), content: 'hello there this is the last message preview '.repeat(2), sender: String(oid()), createdAt: new Date(), type:'text' },
  unreadCount: 0, pinned:false, archived:false, muted:false,
}));
console.log('chat-list payload bytes:', Buffer.byteLength(JSON.stringify({ success:true, chats: chatList })));

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(cors({ origin: (o,cb)=>cb(null,true), credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(mongoSanitize);
app.use(morgan('combined', { stream: { write: () => {} } })); // format cost only, no IO
const fakeProtect = (req, res, next) => {
  let t = req.headers.authorization?.slice(7);
  let decoded;
  try { decoded = jwt.verify(t, process.env.JWT_SECRET, { algorithms:['HS256'] }); }
  catch { return res.status(401).json({ m:'no' }); }
  // exactly what the two DB reads produce after the wire read
  const user = User.hydrate(JSON.parse(rawUserJson));
  const session = Session.hydrate({ ...rawSession });
  if (user.accountStatus !== 'active') return res.status(403).end();
  if ((decoded.tokenVersion||0) !== (user.tokenVersion||0)) return res.status(401).end();
  req.user = user; req.session = session; next();
};
app.use('/api', apiLimiter, csrfGuard);
app.get('/api/bare', (req,res)=>res.json({ success:true }));                       // stack only
app.get('/api/me', fakeProtect, (req,res)=>res.json({ success:true, user: req.user.toSafeJSON() }));
app.get('/api/chats', fakeProtect, (req,res)=>res.json({ success:true, chats: chatList }));
app.get('/api/protect-only', fakeProtect, (req,res)=>res.json({ success:true }));

const server = http.createServer(app);
await new Promise(r => server.listen(5399, r));

// ---- load generator (in-process, keep-alive) ----
const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });
function hit(path, gzip) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port:5399, path, agent, headers: { authorization: 'Bearer '+token, ...(gzip?{'accept-encoding':'gzip'}:{}) } }, (res) => {
      let n = 0; res.on('data', c => n += c.length); res.on('end', () => resolve({ code: res.statusCode, n }));
    });
    req.on('error', reject); req.end();
  });
}
async function bench(path, { gzip=false, conc=32, dur=4000, label } = {}) {
  // reset rate limiter between runs so the 1000/15min cap doesn't distort
  apiLimiter.resetKey('::ffff:127.0.0.1'); apiLimiter.resetKey('127.0.0.1'); apiLimiter.resetKey('::1');
  let done = 0, err = 0, bytes = 0, stop = false, lat = [];
  const end = Date.now() + dur;
  let maxLag = 0, last = Date.now();
  const lagT = setInterval(() => { const now=Date.now(); const l=now-last-10; if (l>maxLag) maxLag=l; last=now; }, 10);
  async function worker() {
    while (!stop && Date.now() < end) {
      const t = process.hrtime.bigint();
      try { const r = await hit(path, gzip); if (r.code >= 400) err++; bytes += r.n; }
      catch { err++; }
      lat.push(Number(process.hrtime.bigint()-t)/1e6);
      done++;
    }
  }
  const t0 = Date.now();
  await Promise.all(Array.from({length:conc}, worker));
  const secs = (Date.now()-t0)/1000;
  clearInterval(lagT);
  lat.sort((a,b)=>a-b);
  const p = (q) => lat[Math.min(lat.length-1, Math.floor(lat.length*q))]?.toFixed(1);
  console.log(`${(label||path).padEnd(28)} ${(done/secs).toFixed(0).padStart(6)} req/s  err=${err}  p50=${p(0.5)}ms p99=${p(0.99)}ms  loopLag(max)=${maxLag}ms  gzip=${gzip}`);
}

await bench('/api/bare', { label:'stack only (no auth)' });
await bench('/api/protect-only', { label:'stack + protect CPU' });
await bench('/api/me', { label:'stack + protect + toSafeJSON' });
await bench('/api/chats', { label:'chats (no gzip)' });
await bench('/api/chats', { gzip:true, label:'chats (gzip)' });
server.close(); process.exit(0);
