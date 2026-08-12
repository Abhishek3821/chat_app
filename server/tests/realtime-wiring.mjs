/**
 * Static audit of the REAL-TIME wiring.
 *
 * Three failure modes that a passing build, a passing test suite and a running
 * server all fail to reveal — and that present to a user exactly as "it doesn't
 * work in real time":
 *
 *   1. NAME MISMATCH — the server emits `user-online`, the client listens for
 *      `presence:online`. Nothing errors. The feature is simply dead.
 *   2. MISSING STORE METHOD — a socket handler calls
 *      `useChat.getState().ingestMessage(...)` after that method was deleted. It
 *      throws a TypeError *inside the handler*, so the event is lost and every
 *      later event of that type is lost too. `scan-undefined.mjs` cannot catch
 *      this: it is a property access, not an identifier.
 *   3. UNHANDLED EMIT — the server sends an event no client listens to (dead
 *      feature), or the client listens for one the server never sends (a feature
 *      that silently never fires).
 *
 * Run:  node tests/realtime-wiring.mjs   (from /server)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const CLIENT_SRC = path.resolve(SERVER_DIR, '..', 'client', 'src');

const walk = (dir, test, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, test, out);
    else if (test(e.name)) out.push(p);
  }
  return out;
};
const rel = (f, base) => path.relative(base, f).replace(/\\/g, '/');
const lineOf = (src, i) => src.slice(0, i).split('\n').length;

/** Blank comments, preserving offsets, so documentation is never a finding. */
const strip = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

let problems = 0;
const section = (t) => console.log(`\n── ${t} ──`);
const fail = (m) => {
  console.log(`  ✗ ${m}`);
  problems += 1;
};
const warn = (m) => console.log(`  ⚠ ${m}`);
const ok = (m) => console.log(`  ✓ ${m}`);

/* ── Collect server-side emitted event names ───────────────────────── */
const serverFiles = walk(SERVER_DIR, (n) => n.endsWith('.js'));
const serverEmits = new Map(); // event -> [where]
for (const f of serverFiles) {
  const src = strip(fs.readFileSync(f, 'utf8'));
  // emitToUser(x, 'evt', …) / emitToChat(x, 'evt', …) / io.to(x).emit('evt', …)
  // / socket.emit('evt') / .emit('evt')
  for (const m of src.matchAll(/\.\s*emit\s*\(\s*'([^']+)'/g)) {
    serverEmits.set(m[1], [...(serverEmits.get(m[1]) || []), `${rel(f, SERVER_DIR)}:${lineOf(src, m.index)}`]);
  }
  for (const m of src.matchAll(/emitTo(?:User|Chat|Room)\s*\(\s*[^,]+,\s*'([^']+)'/g)) {
    serverEmits.set(m[1], [...(serverEmits.get(m[1]) || []), `${rel(f, SERVER_DIR)}:${lineOf(src, m.index)}`]);
  }
}

/* ── Collect server-side handled (inbound) event names ─────────────── */
const serverHandles = new Set();
/** onAll([...]) alias groups — a group is used if ANY of its names is emitted. */
const inboundGroups = [];
for (const f of serverFiles) {
  const src = strip(fs.readFileSync(f, 'utf8'));
  for (const m of src.matchAll(/\b\w+\s*\.\s*on\s*\(\s*'([^']+)'/g)) serverHandles.add(m[1]);
  /* This codebase registers call signalling through an ALIAS helper:
       onAll(['call:invite', 'call-user'], handler)
     and relays under both naming schemes:
       relay(to, ['call:incoming', 'incoming-call'], payload)
     Matching only `socket.on('literal')` missed every call handler and reported
     the entire WebRTC flow as unwired — a false alarm that would have sent
     someone rewriting working signalling. Parse the array forms too. */
  for (const m of src.matchAll(/\bonAll\s*\(\s*\[([^\]]+)\]/g)) {
    for (const q of m[1].matchAll(/'([^']+)'/g)) serverHandles.add(q[1]);
  }
}

/* Events the server RELAYS outbound via the same alias helper. Groups are kept
   intact so §1 can treat a modern+legacy pair as one wiring, not two. */
const relayGroups = [];
for (const f of serverFiles) {
  const src = strip(fs.readFileSync(f, 'utf8'));
  for (const m of src.matchAll(/\brelay\s*\(\s*[^,]+,\s*\[([^\]]+)\]/g)) {
    const names = [...m[1].matchAll(/'([^']+)'/g)].map((q) => q[1]);
    if (names.length) relayGroups.push(names);
    for (const n of names) {
      serverEmits.set(n, [...(serverEmits.get(n) || []), `${rel(f, SERVER_DIR)}:${lineOf(src, m.index)}`]);
    }
  }
  // onAll groups are inbound aliases; same idea for the client→server direction.
  for (const m of src.matchAll(/\bonAll\s*\(\s*\[([^\]]+)\]/g)) {
    const names = [...m[1].matchAll(/'([^']+)'/g)].map((q) => q[1]);
    if (names.length) inboundGroups.push(names);
  }
}

/* ── Collect client-side listeners and emits ───────────────────────── */
const clientFiles = walk(CLIENT_SRC, (n) => /\.(js|jsx)$/.test(n));
const clientListens = new Map();
const clientEmits = new Map();
for (const f of clientFiles) {
  const src = strip(fs.readFileSync(f, 'utf8'));
  /* ANY identifier, not just `socket`: useWebRTC.js registers its whole call
     flow as `s.on('call:offer', …)`. Hard-coding the variable name skipped that
     entire file and reported its events as unhandled. */
  for (const m of src.matchAll(/\b\w+\s*\.\s*on\s*\(\s*'([^']+)'/g)) {
    clientListens.set(m[1], [...(clientListens.get(m[1]) || []), `${rel(f, CLIENT_SRC)}:${lineOf(src, m.index)}`]);
  }
  /* `emitSig` is useWebRTC's signalling wrapper and `emitSocket` the store's —
     both are real client→server emits. Counting only `socket.emit` reported the
     entire call flow as never emitted by anyone. */
  for (const m of src.matchAll(/(?:\w+\s*\.\s*emit|emitSocket|emitSig)\s*\(\s*'([^']+)'/g)) {
    clientEmits.set(m[1], [...(clientEmits.get(m[1]) || []), `${rel(f, CLIENT_SRC)}:${lineOf(src, m.index)}`]);
  }
}

/* Socket.IO built-ins — not application events. */
const BUILTIN = new Set(['connect', 'disconnect', 'connect_error', 'disconnecting', 'error', 'reconnect', 'newListener']);

/* ── 1. Server emits nobody listens for ────────────────────────────── */
section('Server → client events');
/**
 * Alias-aware.
 *
 * Call signalling is deliberately emitted under BOTH a modern and a legacy name
 * (`relay(to, ['call:offer', 'webrtc-offer'], …)`) so older clients keep working.
 * Requiring a listener for EVERY name reported eight healthy events as broken,
 * which is exactly the noise that makes an audit worthless. A relay group is
 * satisfied when ANY name in it is heard; only a group where NOTHING is heard is
 * a real dead end.
 */
const satisfiedByAlias = new Set();
for (const group of relayGroups) {
  if (group.some((e) => clientListens.has(e))) for (const e of group) satisfiedByAlias.add(e);
}
const unheard = [...serverEmits.keys()]
  .filter((e) => !BUILTIN.has(e) && !clientListens.has(e) && !satisfiedByAlias.has(e))
  .sort();
if (unheard.length) {
  for (const e of unheard) fail(`server emits '${e}' but NO client listener exists  (emitted at ${serverEmits.get(e)[0]})`);
} else {
  ok(`all ${serverEmits.size} server-emitted events are heard (counting compat aliases)`);
}
const aliasOnly = [...satisfiedByAlias].filter((e) => !clientListens.has(e));
if (aliasOnly.length) console.log(`  · ${aliasOnly.length} legacy alias(es) emitted for back-compat, handled under their modern name`);

/* ── 2. Client listens for events never emitted ────────────────────── */
const neverSent = [...clientListens.keys()].filter((e) => !BUILTIN.has(e) && !serverEmits.has(e)).sort();
if (neverSent.length) {
  for (const e of neverSent) fail(`client listens for '${e}' but the server never emits it  (listener at ${clientListens.get(e)[0]})`);
} else {
  ok(`all ${clientListens.size} client listeners correspond to a server emit`);
}

/* ── 3. Client emits the server does not handle ────────────────────── */
section('Client → server events');
const unhandled = [...clientEmits.keys()].filter((e) => !BUILTIN.has(e) && !serverHandles.has(e)).sort();
if (unhandled.length) {
  for (const e of unhandled) fail(`client emits '${e}' but the server has no handler  (emitted at ${clientEmits.get(e)[0]})`);
} else {
  ok(`all ${clientEmits.size} client-emitted events are handled by the server`);
}

/* ── 4. Store methods called through getState() must exist ─────────── */
section('Store methods used by real-time handlers');
const storeFiles = walk(path.join(CLIENT_SRC, 'store'), (n) => n.endsWith('.js'));
const storeMethods = new Map(); // useChat -> Set(keys)
for (const f of storeFiles) {
  const name = path.basename(f, '.js'); // useChat
  const src = fs.readFileSync(f, 'utf8');
  const keys = new Set();
  // Top-level keys of the create((set,get)=>({ ... })) object: `key:` at 2-space indent.
  for (const m of src.matchAll(/^ {2}(\w+)\s*:/gm)) keys.add(m[1]);
  storeMethods.set(name, keys);
}

let missing = 0;
for (const f of clientFiles) {
  const src = strip(fs.readFileSync(f, 'utf8'));
  for (const m of src.matchAll(/\b(use[A-Z]\w*)\s*\.\s*getState\s*\(\s*\)\s*\.\s*(\w+)/g)) {
    const [, store, method] = m;
    const known = storeMethods.get(store);
    if (!known) continue; // store defined elsewhere / not a local store file
    if (!known.has(method)) {
      fail(`${rel(f, CLIENT_SRC)}:${lineOf(src, m.index)} — ${store}.getState().${method} does not exist on the store`);
      missing += 1;
    }
  }
}
if (!missing) ok('every getState().method() call resolves to a real store key');

/* ── 5. WebRTC signalling completeness ─────────────────────────────── */
section('WebRTC signalling (the events that establish a call)');
/* The real event names this codebase uses, verified against socket/index.js.
   An earlier version of this list was guessed (`call:initiate`, `call:ice`) and
   reported the whole flow as missing — a scanner asserting its own guesses. */
const CALL_SETUP = [
  ['call:invite', 'client→server', 'ring the callee'],
  ['call:incoming', 'server→client', 'callee starts ringing'],
  ['call:accept', 'client→server', 'callee answers'],
  ['call:accepted', 'server→client', 'caller learns it was answered'],
  ['call:offer', 'both', 'SDP offer'],
  ['call:answer', 'both', 'SDP answer'],
  ['call:ice-candidate', 'both', 'ICE candidates — without these the media path never forms'],
  ['call:reject', 'client→server', 'callee declines'],
  ['call:end', 'client→server', 'hang up'],
  ['call:ended', 'server→client', 'peer hung up'],
];
for (const [evt, direction, why] of CALL_SETUP) {
  const outbound = serverEmits.has(evt);
  const inbound = serverHandles.has(evt);
  const heard = clientListens.has(evt);
  const emitted = clientEmits.has(evt);

  if (direction === 'client→server' && !(emitted && inbound)) fail(`'${evt}' (${why}) — client emits: ${emitted}, server handles: ${inbound}`);
  else if (direction === 'server→client' && !(outbound && heard)) fail(`'${evt}' (${why}) — server emits: ${outbound}, client listens: ${heard}`);
  else if (direction === 'both' && !(emitted && inbound && outbound && heard)) {
    fail(`'${evt}' (${why}) — emit:${emitted} handle:${inbound} relay:${outbound} listen:${heard}`);
  } else ok(`'${evt}' — ${why}`);
}

console.log(`\n${'─'.repeat(60)}`);
console.log(problems ? `${problems} real-time wiring problem(s)` : 'real-time wiring is consistent end to end');
if (problems) process.exitCode = 1;
