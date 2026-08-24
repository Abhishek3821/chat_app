#!/usr/bin/env node
/**
 * Does this relay actually relay?
 *
 * Config that LOOKS right but never yields a relay candidate is the normal way
 * TURN fails, and every symptom of it is indistinguishable from an app bug: the
 * call rings, both sides accept, and there is no audio. So this asks the relay
 * the same question a browser asks — a real RFC 5766 **Allocate** — and reports
 * the relayed transport address it hands back.
 *
 * A successful Allocate is the proof. Nothing else is: a reachable port proves
 * only that something is listening, and `turnutils_uclient` has to be installed
 * on the relay itself, which tests it from the one network you already know works.
 *
 * This talks raw STUN/TURN over UDP, TCP and TLS with no dependencies, so it can
 * run from your laptop, from CI, or from the far side of the mobile network that
 * is actually failing.
 *
 *   # Your own coturn, credentials computed the way the server mints them:
 *   node check-relay.mjs --url "turn:turn.example.com:3478?transport=udp" --secret <TURN_SECRET>
 *
 *   # Everything in server/.env — every relay, every transport:
 *   node check-relay.mjs --env
 *
 *   # A credential pair from any provider (Cloudflare, metered, Twilio):
 *   node check-relay.mjs --url "turns:turn.cloudflare.com:5349?transport=tcp" \
 *                        --username <u> --credential <c>
 *
 *   # A live /api/v1/ice response — tests exactly what the browser was given:
 *   curl -s https://api.example.com/api/v1/ice -H "Authorization: Bearer <t>" \
 *     | node check-relay.mjs --ice -
 *
 * Exit code is 0 only if every relay tested allocated successfully, so it works
 * as a deployment gate.
 */
import crypto from 'crypto';
import dgram from 'dgram';
import net from 'net';
import tls from 'tls';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ── STUN / TURN wire format (RFC 5389 + RFC 5766) ────────────────────── */

const MAGIC = 0x2112a442;
const METHOD_ALLOCATE = 0x0003;
const CLASS_SUCCESS = 0x0100;
const CLASS_ERROR = 0x0110;

const ATTR = {
  MAPPED_ADDRESS: 0x0001,
  USERNAME: 0x0006,
  MESSAGE_INTEGRITY: 0x0008,
  ERROR_CODE: 0x0009,
  REALM: 0x0014,
  NONCE: 0x0015,
  XOR_RELAYED_ADDRESS: 0x0016,
  REQUESTED_TRANSPORT: 0x0019,
  XOR_MAPPED_ADDRESS: 0x0020,
  LIFETIME: 0x000d,
  SOFTWARE: 0x8022,
};

function encodeAttr(type, value) {
  // Every attribute is padded to a 4-byte boundary, but the padding is NOT
  // counted in the declared length. Getting that backwards is the classic bug.
  const pad = (4 - (value.length % 4)) % 4;
  const out = Buffer.alloc(4 + value.length + pad);
  out.writeUInt16BE(type, 0);
  out.writeUInt16BE(value.length, 2);
  value.copy(out, 4);
  return out;
}

/**
 * @param {object}  auth  `{ username, realm, nonce, key }` for the authenticated
 *                        retry, or nothing for the first (deliberately
 *                        unauthenticated) probe that asks for realm + nonce.
 */
function buildAllocate(auth) {
  const tid = crypto.randomBytes(12);
  const parts = [
    // 17 = UDP. TURN only relays UDP for WebRTC; the transport in the URL is how
    // we reach the RELAY, which is a different thing entirely.
    encodeAttr(ATTR.REQUESTED_TRANSPORT, Buffer.from([17, 0, 0, 0])),
    encodeAttr(ATTR.SOFTWARE, Buffer.from('chatkonect-relay-check', 'utf8')),
  ];
  if (auth) {
    parts.push(encodeAttr(ATTR.USERNAME, Buffer.from(auth.username, 'utf8')));
    parts.push(encodeAttr(ATTR.REALM, auth.realm));
    parts.push(encodeAttr(ATTR.NONCE, auth.nonce));
  }
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(20);
  header.writeUInt16BE(METHOD_ALLOCATE, 0);
  header.writeUInt32BE(MAGIC, 4);
  tid.copy(header, 8);

  if (!auth) {
    header.writeUInt16BE(body.length, 2);
    return { msg: Buffer.concat([header, body]), tid };
  }

  /* MESSAGE-INTEGRITY is an HMAC over the message as it will look WITH the
     attribute present — so the length field has to be written to include those
     24 bytes before the HMAC is computed over everything preceding them. */
  header.writeUInt16BE(body.length + 24, 2);
  const mac = crypto.createHmac('sha1', auth.key).update(Buffer.concat([header, body])).digest();
  return { msg: Buffer.concat([header, body, encodeAttr(ATTR.MESSAGE_INTEGRITY, mac)]), tid };
}

function parseMessage(buf) {
  if (!buf || buf.length < 20) return null;
  if (buf.readUInt32BE(4) !== MAGIC) return null;
  const type = buf.readUInt16BE(0);
  const len = buf.readUInt16BE(2);
  const attrs = new Map();
  let off = 20;
  const end = Math.min(20 + len, buf.length);
  while (off + 4 <= end) {
    const t = buf.readUInt16BE(off);
    const l = buf.readUInt16BE(off + 2);
    if (off + 4 + l > buf.length) break;
    attrs.set(t, buf.subarray(off + 4, off + 4 + l));
    off += 4 + l + ((4 - (l % 4)) % 4);
  }
  return { type, tid: buf.subarray(8, 20), attrs, isSuccess: (type & 0x0110) === CLASS_SUCCESS, isError: (type & 0x0110) === CLASS_ERROR };
}

/** XOR-MAPPED / XOR-RELAYED addresses are obfuscated against dumb NAT rewriting. */
function decodeXorAddress(value, tid) {
  if (!value || value.length < 8) return null;
  const family = value[1];
  const port = value.readUInt16BE(2) ^ (MAGIC >>> 16);
  if (family === 0x01) {
    const octets = [];
    for (let i = 0; i < 4; i += 1) octets.push(value[4 + i] ^ ((MAGIC >>> (24 - 8 * i)) & 0xff));
    return `${octets.join('.')}:${port}`;
  }
  if (family === 0x02) {
    // IPv6 XORs against the magic cookie followed by the transaction id.
    const mask = Buffer.concat([Buffer.from([0x21, 0x12, 0xa4, 0x42]), tid]);
    const raw = Buffer.alloc(16);
    for (let i = 0; i < 16; i += 1) raw[i] = value[4 + i] ^ mask[i];
    const groups = [];
    for (let i = 0; i < 16; i += 2) groups.push(raw.readUInt16BE(i).toString(16));
    return `[${groups.join(':')}]:${port}`;
  }
  return null;
}

function decodeError(attrs) {
  const v = attrs.get(ATTR.ERROR_CODE);
  if (!v || v.length < 4) return null;
  return { code: v[2] * 100 + v[3], reason: v.subarray(4).toString('utf8') };
}

/* ── Transports ───────────────────────────────────────────────────────── */

/** A single request/response exchange. Resolves `null` on timeout. */
function exchange(target, msg, timeoutMs) {
  const { proto, host, port, insecure } = target;
  if (proto === 'udp') {
    return new Promise((resolve) => {
      const sock = dgram.createSocket('udp4');
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { sock.close(); } catch { /* already closed */ }
        resolve(v);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      sock.on('message', (d) => finish(d));
      sock.on('error', () => finish(null));
      sock.send(msg, port, host, (err) => { if (err) finish(null); });
    });
  }

  /* STUN over a stream has no framing of its own — the message declares its own
     length, so read until the header says we have all of it. */
  return new Promise((resolve) => {
    let done = false;
    let buf = Buffer.alloc(0);
    const sock =
      proto === 'tls'
        ? tls.connect({ host, port, servername: host, rejectUnauthorized: !insecure })
        : net.connect({ host, port });

    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch { /* already gone */ }
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    sock.on(proto === 'tls' ? 'secureConnect' : 'connect', () => sock.write(msg));
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length >= 20 && buf.length >= 20 + buf.readUInt16BE(2)) finish(buf);
    });
    sock.on('error', (err) => { finish({ error: err }); });
    sock.on('close', () => finish(null));
  });
}

/* ── The check itself ─────────────────────────────────────────────────── */

/**
 * TURN always rejects the first Allocate with 401 + realm + nonce, by design —
 * that is not a failure, it is the handshake. The credential goes in the retry.
 */
async function allocate(target, creds, timeoutMs) {
  const started = Date.now();

  const first = await exchange(target, buildAllocate(null).msg, timeoutMs);
  if (first && first.error) return { ok: false, why: `connect failed — ${first.error.message}` };
  if (!first) {
    return {
      ok: false,
      why: 'no response at all',
      hint:
        target.proto === 'udp'
          ? 'The port is filtered or nothing is listening. Check the cloud security group first, then ufw, then that coturn is running.'
          : 'Nothing accepted the connection. For turns:, also check the certificate is readable by the turnserver user.',
    };
  }

  const challenge = parseMessage(first);
  if (!challenge) return { ok: false, why: 'the reply was not STUN — something else is on this port' };

  const realm = challenge.attrs.get(ATTR.REALM);
  const nonce = challenge.attrs.get(ATTR.NONCE);
  if (!realm || !nonce) {
    const err = decodeError(challenge.attrs);
    return { ok: false, why: err ? `${err.code} ${err.reason} without a realm to authenticate against` : 'no realm/nonce offered' };
  }

  const username = creds.username;
  const key = crypto
    .createHash('md5')
    .update(`${username}:${realm.toString('utf8')}:${creds.credential}`)
    .digest();

  const second = await exchange(target, buildAllocate({ username, realm, nonce, key }).msg, timeoutMs);
  if (second && second.error) return { ok: false, why: `connect failed on the retry — ${second.error.message}` };
  if (!second) return { ok: false, why: 'the authenticated Allocate got no answer', hint: 'The relay answered the first probe, so this is credentials or quota, not the firewall.' };

  const reply = parseMessage(second);
  if (!reply) return { ok: false, why: 'unparseable reply to the authenticated Allocate' };

  if (reply.isError) {
    const err = decodeError(reply.attrs) || { code: 0, reason: 'unknown' };
    const hints = {
      401: 'Credentials rejected. The secret here does not match static-auth-secret on the relay, or the credential has already expired.',
      400: 'The relay refused the request itself — check use-auth-secret is on and lt-cred-mech is NOT also set; the two conflict.',
      437: 'Stale allocation. Harmless here; run it again.',
      438: 'Stale nonce — retry.',
      486: 'Allocation quota reached. user-quota in turnserver.conf is capping this user.',
      508: 'The relay has no ports left in min-port..max-port.',
      300: 'The relay is redirecting to another address (alternate-server).',
    };
    return { ok: false, why: `${err.code} ${err.reason}`, hint: hints[err.code] };
  }

  const relayed = decodeXorAddress(reply.attrs.get(ATTR.XOR_RELAYED_ADDRESS), reply.tid);
  if (!relayed) {
    return {
      ok: false,
      why: 'allocation succeeded but no relayed address came back',
      hint: 'Almost always a missing or wrong external-ip on a cloud VM: coturn allocates on an address it cannot advertise.',
    };
  }

  const lifetime = reply.attrs.get(ATTR.LIFETIME);
  return {
    ok: true,
    relayed,
    seen: decodeXorAddress(reply.attrs.get(ATTR.XOR_MAPPED_ADDRESS), reply.tid),
    lifetime: lifetime && lifetime.length >= 4 ? lifetime.readUInt32BE(0) : null,
    ms: Date.now() - started,
  };
}

/* ── URL / argument handling ──────────────────────────────────────────── */

/** `turns:host:5349?transport=tcp` → `{ proto, host, port }`. */
function parseTurnUrl(raw) {
  const url = String(raw).trim();
  const m = /^(turns?):(\[[^\]]+\]|[^:?]+)(?::(\d+))?(?:\?(.*))?$/i.exec(url);
  if (!m) return { error: `not a TURN url: ${url}` };
  const secure = m[1].toLowerCase() === 'turns';
  const host = m[2].replace(/^\[|\]$/g, '');
  const query = new URLSearchParams(m[4] || '');
  const transport = (query.get('transport') || (secure ? 'tcp' : 'udp')).toLowerCase();
  if (secure && transport === 'udp') {
    // turns: is TLS over TCP. DTLS is a different thing and coturn does not do it here.
    return { error: `turns: with transport=udp is not a thing — drop the parameter: ${url}` };
  }
  return {
    url,
    proto: secure ? 'tls' : transport === 'tcp' ? 'tcp' : 'udp',
    host,
    port: Number(m[3]) || (secure ? 5349 : 3478),
  };
}

function mintCredential(secret, scope) {
  // Exactly what server/utils/iceCoturn.js does, so a pass here means the
  // app's own credentials work — not merely that some credential works.
  const expiry = Math.floor(Date.now() / 1000) + 600;
  const username = `${expiry}:${scope}`;
  return { username, credential: crypto.createHmac('sha1', secret).update(username).digest('base64') };
}

function parseArgs(argv) {
  const out = { targets: [], timeout: 5000, insecure: false, scope: 'relay-check' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--url') out.url = next();
    else if (a === '--secret') out.secret = next();
    else if (a === '--username') out.username = next();
    else if (a === '--credential') out.credential = next();
    else if (a === '--ice') out.ice = next();
    else if (a === '--env') out.env = true;
    else if (a === '--scope') out.scope = next();
    else if (a === '--timeout') out.timeout = Number(next()) || 5000;
    else if (a === '--insecure') out.insecure = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else return { error: `unknown argument: ${a}` };
  }
  return out;
}

const USAGE = `
Prove a TURN relay actually relays, by performing a real Allocate.

  --env                          read TURN_URL + TURN_SECRET from server/.env and
                                 test every relay and every transport
  --url <turn:…>                 one relay url (repeat via --env or --ice for many)
  --secret <s>                   coturn static-auth-secret; the credential is
                                 minted the same way the app mints it
  --username <u> --credential <c>  use a ready-made pair (any provider)
  --ice <file|->                 test a whole /api/v1/ice response
  --scope <s>                    label inside the minted username (default relay-check)
  --timeout <ms>                 per-exchange timeout (default 5000)
  --insecure                     skip TLS verification on turns: (diagnosis only)

Exit code 0 only if every relay allocated.
`;

/* Read TURN_URL / TURN_SECRET out of server/.env without pulling in dotenv, so
   this file stays runnable from anywhere including a bare relay box. */
function readServerEnv() {
  const file = path.resolve(__dirname, '../../server/.env');
  if (!fs.existsSync(file)) return { error: `no server/.env at ${file}` };
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return env;
}

/* ── main ─────────────────────────────────────────────────────────────── */

const args = parseArgs(process.argv.slice(2));
if (args.error) { console.error(args.error); process.exit(2); }
if (args.help || process.argv.length <= 2) { console.log(USAGE); process.exit(args.help ? 0 : 2); }

/** Every relay to test: `{ url, proto, host, port, username, credential, label }`. */
const jobs = [];

if (args.env) {
  const env = readServerEnv();
  if (env.error) { console.error(env.error); process.exit(2); }
  if (!env.TURN_URL || !env.TURN_SECRET) {
    console.error('server/.env has no TURN_URL + TURN_SECRET — nothing to check. That itself is why cross-network calls fail.');
    process.exit(2);
  }
  const groups = env.TURN_URL.split('|').map((g) => g.split(',').map((u) => u.trim()).filter(Boolean)).filter((g) => g.length);
  const secrets = env.TURN_SECRET.split('|').map((s) => s.trim()).filter(Boolean);
  groups.forEach((urls, gi) => {
    const secret = secrets.length === 1 ? secrets[0] : secrets[gi];
    if (!secret) {
      console.warn(`⚠️  relay group ${gi + 1} has no matching secret — the server drops it too, so it is not tested.`);
      return;
    }
    const creds = mintCredential(secret, args.scope);
    for (const u of urls) {
      const t = parseTurnUrl(u);
      if (t.error) { console.warn('⚠️  ' + t.error); continue; }
      jobs.push({ ...t, ...creds, label: groups.length > 1 ? `relay ${gi + 1}` : '' });
    }
  });
} else if (args.ice) {
  const raw = args.ice === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(args.ice, 'utf8');
  let body;
  try { body = JSON.parse(raw); } catch { console.error('could not parse that as JSON'); process.exit(2); }
  const list = Array.isArray(body) ? body : body.iceServers || [];
  for (const s of Array.isArray(list) ? list : [list]) {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    for (const u of urls) {
      if (!/^turns?:/i.test(String(u))) continue; // STUN entries need no proving
      const t = parseTurnUrl(u);
      if (t.error) { console.warn('⚠️  ' + t.error); continue; }
      if (!s.username || !s.credential) { console.warn(`⚠️  ${u} came with no credentials — skipped`); continue; }
      jobs.push({ ...t, username: s.username, credential: s.credential, label: '' });
    }
  }
  if (!jobs.length) { console.error('That /ice response contains no relay with credentials — the deployment is STUN-only.'); process.exit(1); }
} else if (args.url) {
  const t = parseTurnUrl(args.url);
  if (t.error) { console.error(t.error); process.exit(2); }
  if (args.secret) jobs.push({ ...t, ...mintCredential(args.secret, args.scope) });
  else if (args.username && args.credential) jobs.push({ ...t, username: args.username, credential: args.credential, label: '' });
  else { console.error('need either --secret, or --username with --credential'); process.exit(2); }
} else {
  console.error('nothing to test — pass --env, --url or --ice');
  process.exit(2);
}

console.log(`\nTesting ${jobs.length} relay endpoint${jobs.length === 1 ? '' : 's'}…\n`);

let failures = 0;
for (const job of jobs) {
  const tag = job.label ? `${job.label}  ` : '';
  process.stdout.write(`  ${tag}${job.proto.toUpperCase().padEnd(4)} ${job.host}:${job.port} … `);
  /* Sequential on purpose: a relay that is rate-limiting or quota-capped gives a
     misleading answer when several allocations land at once. */
  const res = await allocate({ ...job, insecure: args.insecure }, job, args.timeout);
  if (res.ok) {
    console.log(`✓ relayed via ${res.relayed}  (${res.ms}ms${res.lifetime ? `, lifetime ${res.lifetime}s` : ''})`);
    if (res.seen) console.log(`       your address as the relay sees it: ${res.seen}`);
  } else {
    failures += 1;
    console.log(`✗ ${res.why}`);
    if (res.hint) console.log(`       → ${res.hint}`);
  }
}

console.log('');
if (failures) {
  console.log(`${jobs.length - failures}/${jobs.length} endpoints relayed. ${failures} did not.`);
  console.log('A relay that does not allocate cannot carry a call between two strict NATs.');
  process.exit(1);
}
console.log(`All ${jobs.length} endpoint${jobs.length === 1 ? '' : 's'} allocated successfully — this relay can carry media between two networks that cannot reach each other directly.`);
