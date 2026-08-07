import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import os from 'os';

const SECRET = 'x'.repeat(48);
const tok = jwt.sign({ id: 'a'.repeat(24), role: 'user', tokenVersion: 0, sid: 'b'.repeat(24), type: 'access' }, SECRET, { algorithm: 'HS256', expiresIn: '1h' });
console.log('token bytes:', tok.length);

// warm up
for (let i = 0; i < 5000; i++) jwt.verify(tok, SECRET, { algorithms: ['HS256'] });
const N = 50000;
let t0 = process.hrtime.bigint();
for (let i = 0; i < N; i++) jwt.verify(tok, SECRET, { algorithms: ['HS256'] });
let t1 = process.hrtime.bigint();
console.log('jwt.verify (string secret) us/op:', ((Number(t1 - t0) / 1e3) / N).toFixed(1));

const keyObj = crypto.createSecretKey(Buffer.from(SECRET));
for (let i = 0; i < 5000; i++) jwt.verify(tok, keyObj, { algorithms: ['HS256'] });
t0 = process.hrtime.bigint();
for (let i = 0; i < N; i++) jwt.verify(tok, keyObj, { algorithms: ['HS256'] });
t1 = process.hrtime.bigint();
console.log('jwt.verify (KeyObject) us/op:', ((Number(t1 - t0) / 1e3) / N).toFixed(1));

// raw HMAC for reference
t0 = process.hrtime.bigint();
for (let i = 0; i < N; i++) crypto.createHmac('sha256', SECRET).update(tok.slice(0, 200)).digest('base64');
t1 = process.hrtime.bigint();
console.log('raw HMAC-SHA256 us/op:', ((Number(t1 - t0) / 1e3) / N).toFixed(1));

// mongoSanitize scrub cost on a typical + a hostile body
const { mongoSanitize } = await import('./middleware/sanitize.js');
function mkReq(body) { return { body, query: {}, params: {} }; }
const typical = { content: 'hello world '.repeat(10), chatId: 'a'.repeat(24), type: 'text', replyTo: null };
t0 = process.hrtime.bigint();
for (let i = 0; i < N; i++) mongoSanitize(mkReq(JSON.parse(JSON.stringify(typical))), null, () => {});
t1 = process.hrtime.bigint();
console.log('mongoSanitize typical body us/op (incl. clone):', ((Number(t1 - t0) / 1e3) / N).toFixed(1));

// hostile: 2MB body of many keys, depth 8
function deepWide(width, depth) {
  if (depth === 0) return 'x';
  const o = {};
  for (let i = 0; i < width; i++) o['k' + i] = deepWide(width, depth - 1);
  return o;
}
const hostile = deepWide(6, 8); // 6^8 ≈ 1.68M leaves -> too big; measure smaller
const hostile2 = deepWide(5, 7); // 5^7 = 78k
const bigJson = JSON.stringify(hostile2);
console.log('hostile2 JSON bytes:', bigJson.length);
t0 = process.hrtime.bigint();
const parsed = JSON.parse(bigJson);
t1 = process.hrtime.bigint();
console.log('JSON.parse of that body ms:', (Number(t1 - t0) / 1e6).toFixed(1));
t0 = process.hrtime.bigint();
mongoSanitize({ body: parsed, query: {}, params: {} }, null, () => {});
t1 = process.hrtime.bigint();
console.log('mongoSanitize on that body ms:', (Number(t1 - t0) / 1e6).toFixed(1));

// a 2MB flat string array body (realistic max under express limit 2mb)
const flat = { a: 'y'.repeat(2 * 1024 * 1024 - 20) };
const flatJson = JSON.stringify(flat);
console.log('flat JSON bytes:', flatJson.length);
t0 = process.hrtime.bigint();
JSON.parse(flatJson);
t1 = process.hrtime.bigint();
console.log('JSON.parse 2MB flat string ms:', (Number(t1 - t0) / 1e6).toFixed(2));

// deep array-of-objects 2MB (worst realistic scrub)
const arr = [];
while (JSON.stringify(arr).length < 2 * 1024 * 1024 - 1000) {
  arr.push({ aaaaaaaa: 1, bbbbbbbb: 2, cccccccc: 3, dddddddd: 4, eeeeeeee: 5, ffffffff: 6, gggggggg: 7, hhhhhhhh: 8 });
}
const arrJson = JSON.stringify({ items: arr });
console.log('array body bytes:', arrJson.length, 'elements:', arr.length);
t0 = process.hrtime.bigint();
const ap = JSON.parse(arrJson);
t1 = process.hrtime.bigint();
console.log('JSON.parse 2MB array ms:', (Number(t1 - t0) / 1e6).toFixed(2));
t0 = process.hrtime.bigint();
mongoSanitize({ body: ap, query: {}, params: {} }, null, () => {});
t1 = process.hrtime.bigint();
console.log('mongoSanitize 2MB array ms:', (Number(t1 - t0) / 1e6).toFixed(2));

console.log('node', process.version, 'cpus', os.cpus().length);
