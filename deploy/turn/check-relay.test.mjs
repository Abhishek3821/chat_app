#!/usr/bin/env node
/**
 * Does check-relay.mjs speak TURN correctly?
 *
 * A prober that reports "✗ no response" for every relay looks exactly like a
 * prober that is silently malformed, and the failure is invisible: you would
 * conclude the relay is broken and start reconfiguring a firewall that was fine.
 * So this stands up a minimal TURN responder and requires a PASS from it.
 *
 * The responder verifies MESSAGE-INTEGRITY with its own independent
 * implementation of RFC 5389 §15.4 — the long-term-credential key derivation and
 * the "length field must already include the attribute" rule. That is the part
 * that is easy to get subtly wrong, so having two implementations agree is the
 * actual test; the rest is plumbing.
 *
 * No Mongo, no network, no coturn. Runs anywhere.
 *
 *   node deploy/turn/check-relay.test.mjs
 */
import crypto from 'crypto';
import dgram from 'dgram';
import net from 'net';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(__dirname, 'check-relay.mjs');

const MAGIC = 0x2112a442;
const REALM = 'relay.test';
const SECRET = 'static-auth-secret-for-this-test';

const results = [];
const check = (name, cond, detail = '') => {
  results.push(!!cond);
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || !detail ? '' : `  — ${detail}`}`);
};
const section = (t) => console.log(`\n— ${t}`);

/* ── A minimal TURN responder ─────────────────────────────────────────── */

const attr = (type, value) => {
  const pad = (4 - (value.length % 4)) % 4;
  const b = Buffer.alloc(4 + value.length + pad);
  b.writeUInt16BE(type, 0);
  b.writeUInt16BE(value.length, 2);
  value.copy(b, 4);
  return b;
};

const xorAddr = (ip, port) => {
  const v = Buffer.alloc(8);
  v[0] = 0;
  v[1] = 1; // IPv4
  v.writeUInt16BE(port ^ (MAGIC >>> 16), 2);
  ip.split('.').forEach((o, i) => { v[4 + i] = Number(o) ^ ((MAGIC >>> (24 - 8 * i)) & 0xff); });
  return v;
};

function reply(type, tid, attrs) {
  const body = Buffer.concat(attrs);
  const header = Buffer.alloc(20);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(body.length, 2);
  header.writeUInt32BE(MAGIC, 4);
  tid.copy(header, 8);
  return Buffer.concat([header, body]);
}

function readAttrs(buf) {
  const out = new Map();
  const len = buf.readUInt16BE(2);
  let off = 20;
  while (off + 4 <= Math.min(20 + len, buf.length)) {
    const t = buf.readUInt16BE(off);
    const l = buf.readUInt16BE(off + 2);
    out.set(t, { value: buf.subarray(off + 4, off + 4 + l), offset: off });
    off += 4 + l + ((4 - (l % 4)) % 4);
  }
  return out;
}

/**
 * The independent half. `mode` decides what this relay pretends to be:
 *   'ok'          — a correctly configured relay
 *   'wrong-secret'— static-auth-secret does not match the caller's
 *   'no-external' — allocates but advertises no relayed address (missing external-ip)
 *   'silent'      — a filtered port
 */
function handle(buf, mode, seenFrom) {
  if (mode === 'silent') return null;
  if (buf.length < 20 || buf.readUInt32BE(4) !== MAGIC) return null;
  const tid = buf.subarray(8, 20);
  const attrs = readAttrs(buf);

  const mi = attrs.get(0x0008);
  if (!mi) {
    /* Unauthenticated first probe — challenge it. This is the normal handshake,
       not an error, and a prober that treats it as one never gets anywhere. */
    const err = Buffer.alloc(4);
    err[2] = 4;
    err[3] = 1; // 401
    return reply(0x0113, tid, [
      attr(0x0009, Buffer.concat([err, Buffer.from('Unauthorized', 'utf8')])),
      attr(0x0014, Buffer.from(REALM, 'utf8')),
      attr(0x0015, Buffer.from('nonce-' + crypto.randomBytes(6).toString('hex'), 'utf8')),
    ]);
  }

  const usernameAttr = attrs.get(0x0006);
  if (!usernameAttr) return reply(0x0113, tid, [attr(0x0009, Buffer.from([0, 0, 4, 0, 0x62, 0x61, 0x64, 0x00]))]);
  const username = usernameAttr.value.toString('utf8');

  /* coturn's use-auth-secret: the PASSWORD is base64(HMAC-SHA1(secret, username)).
     Recomputed here rather than trusted, which is what makes this a real check of
     the credential the app mints. */
  const secret = mode === 'wrong-secret' ? 'a-different-secret-entirely' : SECRET;
  const password = crypto.createHmac('sha1', secret).update(username).digest('base64');
  const key = crypto.createHash('md5').update(`${username}:${REALM}:${password}`).digest();

  /* RFC 5389 §15.4: the HMAC covers everything before the MESSAGE-INTEGRITY
     attribute, with the header length field set as if the attribute were already
     present. It is the last attribute here, so the length as received is exactly
     that — no rewriting needed. */
  const covered = buf.subarray(0, mi.offset);
  const expected = crypto.createHmac('sha1', key).update(covered).digest();

  if (!crypto.timingSafeEqual(expected, mi.value)) {
    const err = Buffer.alloc(4);
    err[2] = 4;
    err[3] = 1;
    return reply(0x0113, tid, [
      attr(0x0009, Buffer.concat([err, Buffer.from('Unauthorized', 'utf8')])),
      attr(0x0014, Buffer.from(REALM, 'utf8')),
      attr(0x0015, Buffer.from('nonce-' + crypto.randomBytes(6).toString('hex'), 'utf8')),
    ]);
  }

  integrityVerified += 1;

  const out = [attr(0x0020, xorAddr(seenFrom || '198.51.100.42', 51234)), attr(0x000d, (() => { const b = Buffer.alloc(4); b.writeUInt32BE(600, 0); return b; })())];
  if (mode !== 'no-external') out.unshift(attr(0x0016, xorAddr('203.0.113.7', 49200)));
  return reply(0x0103, tid, out);
}

let integrityVerified = 0;
let mode = 'ok';

const udp = dgram.createSocket('udp4');
udp.on('message', (msg, rinfo) => {
  const res = handle(msg, mode, rinfo.address === '127.0.0.1' ? '198.51.100.42' : rinfo.address);
  if (res) udp.send(res, rinfo.port, rinfo.address);
});

const tcp = net.createServer((sock) => {
  let buf = Buffer.alloc(0);
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 20 && buf.length >= 20 + buf.readUInt16BE(2)) {
      const total = 20 + buf.readUInt16BE(2);
      const msg = buf.subarray(0, total);
      buf = buf.subarray(total);
      const res = handle(msg, mode, '198.51.100.42');
      if (res) sock.write(res);
    }
  });
  sock.on('error', () => { /* the prober closes abruptly; that is fine */ });
});

const listen = () =>
  Promise.all([
    new Promise((r) => udp.bind(0, '127.0.0.1', r)),
    new Promise((r) => tcp.listen(0, '127.0.0.1', r)),
  ]);

const run = (args) =>
  new Promise((resolve) => {
    execFile(process.execPath, [TOOL, ...args], { timeout: 30000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code === undefined ? 1 : err.code) : 0, out: String(stdout) + String(stderr) });
    });
  });

/* ── The checks ───────────────────────────────────────────────────────── */

await listen();
const UDP_PORT = udp.address().port;
const TCP_PORT = tcp.address().port;

section('A correctly configured relay');
mode = 'ok';
integrityVerified = 0;
let r = await run(['--url', `turn:127.0.0.1:${UDP_PORT}?transport=udp`, '--secret', SECRET, '--timeout', '4000']);
check('exit code 0', r.code === 0, `exit ${r.code}\n${r.out}`);
check('reports the relayed address the relay allocated', /relayed via 203\.0\.113\.7:49200/.test(r.out), r.out.trim());
check('reports the address the relay saw us from', /198\.51\.100\.42:51234/.test(r.out), r.out.trim());
check('reports the allocation lifetime', /lifetime 600s/.test(r.out), r.out.trim());
check(
  'the relay independently verified MESSAGE-INTEGRITY',
  integrityVerified === 1,
  `${integrityVerified} — if 0, the prober authenticated wrongly and every real relay would 401`
);

section('The same over TCP, for networks that block UDP');
integrityVerified = 0;
r = await run(['--url', `turn:127.0.0.1:${TCP_PORT}?transport=tcp`, '--secret', SECRET, '--timeout', '4000']);
check('exit code 0', r.code === 0, `exit ${r.code}\n${r.out}`);
check('stream framing is read correctly', /relayed via 203\.0\.113\.7:49200/.test(r.out), r.out.trim());
check('integrity verified over TCP too', integrityVerified === 1, String(integrityVerified));

section('A credential the relay rejects — the wrong-secret case');
mode = 'wrong-secret';
r = await run(['--url', `turn:127.0.0.1:${UDP_PORT}?transport=udp`, '--secret', SECRET, '--timeout', '4000']);
check('exit code is non-zero', r.code !== 0, `exit ${r.code}`);
check('reports 401 rather than a timeout', /401/.test(r.out), r.out.trim());
check('names the actual cause: secret mismatch', /does not match static-auth-secret/.test(r.out), r.out.trim());

section('Allocates but advertises nothing — the missing external-ip case');
mode = 'no-external';
r = await run(['--url', `turn:127.0.0.1:${UDP_PORT}?transport=udp`, '--secret', SECRET, '--timeout', '4000']);
check('exit code is non-zero', r.code !== 0, `exit ${r.code}`);
check(
  'distinguishes this from a rejected credential',
  /no relayed address came back/.test(r.out) && !/401/.test(r.out),
  r.out.trim()
);
check('names external-ip, the most common cloud-VM mistake', /external-ip/.test(r.out), r.out.trim());

section('A filtered port');
mode = 'silent';
r = await run(['--url', `turn:127.0.0.1:${UDP_PORT}?transport=udp`, '--secret', SECRET, '--timeout', '1500']);
check('exit code is non-zero', r.code !== 0, `exit ${r.code}`);
check('says there was no response at all', /no response at all/.test(r.out), r.out.trim());
check('points at the firewall, not at credentials', /security group/.test(r.out), r.out.trim());

section('An unreachable port, so a closed port is not read as a pass');
mode = 'ok';
r = await run(['--url', `turn:127.0.0.1:1?transport=tcp`, '--secret', SECRET, '--timeout', '2000']);
check('exit code is non-zero', r.code !== 0, `exit ${r.code}`);
check('reports the connection failure', /connect failed|no response/.test(r.out), r.out.trim());

section('Argument handling');
r = await run(['--url', 'turns:relay.test:5349?transport=udp', '--secret', SECRET]);
check('turns: with transport=udp is rejected, not silently dialled', r.code === 2 && /not a thing/.test(r.out), r.out.trim());
r = await run(['--url', `turn:127.0.0.1:${UDP_PORT}`]);
check('refuses to run with no credentials', r.code === 2 && /--secret/.test(r.out), r.out.trim());
r = await run(['--ice', '-']);
check('an /ice payload with no relay is a failure, not a pass', r.code !== 0, `exit ${r.code}`);

section('A whole /ice response, the way the browser got it');
const icePayload = JSON.stringify({
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302'] },
    (() => {
      const expiry = Math.floor(Date.now() / 1000) + 600;
      const username = `${expiry}:ice-payload-test`;
      return {
        urls: [`turn:127.0.0.1:${UDP_PORT}?transport=udp`, `turn:127.0.0.1:${TCP_PORT}?transport=tcp`],
        username,
        credential: crypto.createHmac('sha1', SECRET).update(username).digest('base64'),
      };
    })(),
  ],
});
integrityVerified = 0;
const icePath = path.join(__dirname, '.ice-test.json');
const fs = await import('fs');
fs.writeFileSync(icePath, icePayload);
r = await run(['--ice', icePath, '--timeout', '4000']);
fs.unlinkSync(icePath);
check('exit code 0', r.code === 0, `exit ${r.code}\n${r.out}`);
check('every transport in the entry is tested, not just the first', integrityVerified === 2, `${integrityVerified} allocation(s)`);
check('STUN entries are skipped rather than failed', !/stun:/.test(r.out), r.out.trim());

/* ── done ─────────────────────────────────────────────────────────────── */

udp.close();
tcp.close();

const passed = results.filter(Boolean).length;
console.log(`\n${'─'.repeat(56)}\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
