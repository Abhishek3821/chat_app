// EPHEMERAL: end-to-end realtime check against the DEPLOYED backend.
// Logs in two seeded demo users, opens two Socket.IO connections, then checks
// (1) presence registration, (2) realtime message delivery, (3) call ringing.
import { io } from 'socket.io-client';

const BASE = 'https://chat-app-zqj9.onrender.com';
const API = `${BASE}/api`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(method, url, { token, body } = {}) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data };
}

function connectSocket(token, label) {
  return new Promise((resolve) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket', 'polling'], reconnection: false, timeout: 15000 });
    const t = setTimeout(() => resolve({ ok: false, why: 'timeout' }), 20000);
    s.on('connect', () => { clearTimeout(t); resolve({ ok: true, socket: s }); });
    s.on('connect_error', (err) => { clearTimeout(t); resolve({ ok: false, why: err.message }); });
  });
}

const waitFor = (socket, event, timeout = 8000) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeout);
    socket.once(event, (p) => { clearTimeout(t); resolve(p); });
  });

// ── logins ──
const la = await http('POST', '/auth/login', { body: { identifier: 'aria@chatconnect.app', password: 'password123' } });
const lb = await http('POST', '/auth/login', { body: { identifier: 'leo@chatconnect.app', password: 'password123' } });
console.log('login aria:', la.status, la.data?.token ? 'token ok' : JSON.stringify(la.data)?.slice(0, 120));
console.log('login leo :', lb.status, lb.data?.token ? 'token ok' : JSON.stringify(lb.data)?.slice(0, 120));
if (!la.data?.token || !lb.data?.token) { console.log('RESULT: cannot test — demo accounts unavailable on deployed DB'); process.exit(1); }
const A = { token: la.data.token, id: la.data.user._id };
const B = { token: lb.data.token, id: lb.data.user._id };

// ── sockets ──
const sa = await connectSocket(A.token, 'A');
const sb = await connectSocket(B.token, 'B');
console.log('socket A connect:', sa.ok ? 'OK' : `FAILED — ${sa.why}`);
console.log('socket B connect:', sb.ok ? 'OK' : `FAILED — ${sb.why}`);
if (!sa.ok || !sb.ok) { console.log('RESULT: SOCKET CONNECTION BROKEN ON DEPLOYED SERVER'); process.exit(1); }

// register presence (like the client does)
sa.socket.emit('register-user', { userId: A.id });
sb.socket.emit('register-user', { userId: B.id });
await sleep(1500);

// ── realtime message ──
const chat = await http('POST', `/chats/direct/${B.id}`, { token: A.token });
const chatId = chat.data?.chat?._id;
console.log('direct chat:', chat.status, chatId ? 'ok' : JSON.stringify(chat.data)?.slice(0, 120));
const recv = waitFor(sb.socket, 'receive-message');
const msg = await http('POST', '/messages', { token: A.token, body: { chatId, content: `rt-check ${A.id.slice(-4)}`, type: 'text' } });
console.log('send message:', msg.status);
const got = await recv;
console.log('B received realtime message:', got ? 'YES ✅' : 'NO ❌ (this is the bug)');

// ── realtime call ──
const ring = waitFor(sb.socket, 'call:incoming');
const call = await http('POST', '/calls/start', { token: A.token, body: { receiverId: B.id, callType: 'video' } });
console.log('start call:', call.status, `receiverOnline=${call.data?.receiverOnline}`);
const rang = await ring;
console.log('B phone rang in realtime:', rang ? 'YES ✅' : 'NO ❌');

sa.socket.disconnect(); sb.socket.disconnect();
process.exit(0);
