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
import rateLimit from 'express-rate-limit';
import User from './models/User.js';
import Session from './models/Session.js';
import { mongoSanitize } from './middleware/sanitize.js';
import { csrfGuard } from './middleware/csrf.js';

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
const chatList = Array.from({ length: 40 }, (_, i) => ({
  _id: String(oid()), isGroup: false, name: 'Chat ' + i, updatedAt: new Date(),
  participants: [{ user: { _id: String(oid()), name: 'Person '+i, username:'p'+i, avatar:'', isOnline:true, lastSeen:new Date(), presenceState:'available' } }],
  lastMessage: { _id: String(oid()), content: 'hello there this is the last message preview '.repeat(2), sender: String(oid()), createdAt: new Date(), type:'text' },
  unreadCount: 0, pinned:false, archived:false, muted:false,
}));

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(cors({ origin: (o,cb)=>cb(null,true), credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(mongoSanitize);
app.use(morgan('combined', { stream: { write: () => {} } }));
const bigLimiter = rateLimit({ windowMs: 900000, max: 100000000, standardHeaders: true, legacyHeaders: false, validate: false });
const fakeProtect = (req, res, next) => {
  let t = req.headers.authorization?.slice(7);
  let decoded;
  try { decoded = jwt.verify(t, process.env.JWT_SECRET, { algorithms:['HS256'] }); }
  catch { return res.status(401).json({ m:'no' }); }
  const user = User.hydrate(JSON.parse(rawUserJson));
  const session = Session.hydrate({ ...rawSession });
  if (user.accountStatus !== 'active') return res.status(403).end();
  if ((decoded.tokenVersion||0) !== (user.tokenVersion||0)) return res.status(401).end();
  req.user = user; req._sess = session; next();
};
// route with NO middleware chain at all — absolute Node/http baseline
app.get('/raw', (req,res)=>{ res.setHeader('content-type','application/json'); res.end('{"success":true}'); });
app.use('/api', bigLimiter, csrfGuard);
app.get('/api/bare', (req,res)=>res.json({ success:true }));
app.get('/api/protect-only', fakeProtect, (req,res)=>res.json({ success:true }));
app.get('/api/me', fakeProtect, (req,res)=>res.json({ success:true, user: req.user.toSafeJSON() }));
app.get('/api/chats', fakeProtect, (req,res)=>res.json({ success:true, chats: chatList }));
app.get('/api/jwtonly', (req,res)=>{ try { jwt.verify(req.headers.authorization?.slice(7), process.env.JWT_SECRET, { algorithms:['HS256'] }); } catch {} res.json({ok:1}); });
const server = http.createServer(app);
server.keepAliveTimeout = 60000;
server.listen(5399, () => { console.log('READY ' + token); });
