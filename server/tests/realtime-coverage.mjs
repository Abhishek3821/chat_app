/**
 * Which real-time events are actually PROVEN, and which are only assumed?
 *
 * `realtime-wiring.mjs` proves the names match on both sides. That is necessary
 * but not sufficient: a correctly-named event can still never fire, or fire to
 * the wrong room, and the user experiences that as "I have to refresh".
 *
 * This lists every server→client event and reports whether any test suite
 * actually WAITS FOR IT on a real socket. A `waitFor(socket, 'x')` is evidence;
 * a REST assertion is not, because every one of these paths already works on
 * refresh — that is precisely why the bugs were invisible.
 *
 * Output is a coverage report, not a pass/fail gate: some events are legitimately
 * hard to trigger from a test (a sweeper timer, a third-party push receipt), and
 * the point is to know WHICH ones those are rather than to pretend they are covered.
 *
 * Run:  node tests/realtime-coverage.mjs   (from /server)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const TESTS_DIR = __dirname;

const walk = (dir, test, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, test, out);
    else if (test(e.name)) out.push(p);
  }
  return out;
};

const strip = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

/* ── Every server→client event ─────────────────────────────────────── */
const serverFiles = walk(SERVER_DIR, (n) => n.endsWith('.js')).filter((f) => !f.includes(`${path.sep}tests${path.sep}`));
const emitted = new Map(); // event -> Set(source files)
for (const f of serverFiles) {
  const src = strip(fs.readFileSync(f, 'utf8'));
  const add = (evt) => {
    if (!emitted.has(evt)) emitted.set(evt, new Set());
    emitted.get(evt).add(path.relative(SERVER_DIR, f).replace(/\\/g, '/'));
  };
  for (const m of src.matchAll(/\.\s*emit\s*\(\s*'([^']+)'/g)) add(m[1]);
  for (const m of src.matchAll(/emitTo(?:User|Chat|Room)\s*\(\s*[^,]+,\s*'([^']+)'/g)) add(m[1]);
  // relay(to, ['modern', 'legacy'], …) — alias groups
  for (const m of src.matchAll(/\brelay\s*\(\s*[^,]+,\s*\[([^\]]+)\]/g)) {
    for (const q of m[1].matchAll(/'([^']+)'/g)) add(q[1]);
  }
}

/* ── Which events does a test WAIT FOR on a socket? ────────────────── */
const testFiles = walk(TESTS_DIR, (n) => n.endsWith('.mjs'));
const proven = new Map(); // event -> Set(suites)
for (const f of testFiles) {
  const src = strip(fs.readFileSync(f, 'utf8'));
  const suite = path.basename(f, '.mjs');
  // waitFor(sock, 'evt')  ·  socket.on('evt')  ·  socket.once('evt')
  for (const m of src.matchAll(/(?:waitFor\s*\(\s*\w+\s*,\s*|\w+\s*\.\s*(?:on|once)\s*\(\s*)'([^']+)'/g)) {
    if (!proven.has(m[1])) proven.set(m[1], new Set());
    proven.get(m[1]).add(suite);
  }
}

/* Events a test cannot reasonably drive, with the reason. Listed explicitly so
   "uncovered" never silently includes something that IS testable. */
const UNTESTABLE = {
  'pin-expired': 'fired by the pin sweeper on a timer (up to 24h out)',
  'message-expired': 'disappearing-message TTL, driven by MongoDB not the app',
  'presence-state': 'echo to the sender own devices; asserted via REST in privacy-settings',
};
const BUILTIN = new Set(['connect', 'disconnect', 'connect_error', 'disconnecting', 'error']);

const rows = [...emitted.keys()]
  .filter((e) => !BUILTIN.has(e))
  .sort()
  .map((evt) => ({
    evt,
    sources: [...emitted.get(evt)],
    suites: [...(proven.get(evt) || [])],
  }));

const covered = rows.filter((r) => r.suites.length);
const uncovered = rows.filter((r) => !r.suites.length && !UNTESTABLE[r.evt]);
const excused = rows.filter((r) => !r.suites.length && UNTESTABLE[r.evt]);

console.log(`Server emits ${rows.length} distinct client-facing events.\n`);
console.log(`── PROVEN on a real socket (${covered.length}) ──`);
for (const r of covered) console.log(`  ✓ ${r.evt.padEnd(26)} ${r.suites.join(', ')}`);

if (excused.length) {
  console.log(`\n── not socket-testable (${excused.length}) ──`);
  for (const r of excused) console.log(`  · ${r.evt.padEnd(26)} ${UNTESTABLE[r.evt]}`);
}

if (uncovered.length) {
  console.log(`\n── NO socket-level proof (${uncovered.length}) ──`);
  for (const r of uncovered) console.log(`  ✗ ${r.evt.padEnd(26)} emitted from ${r.sources.join(', ')}`);
}

const pct = Math.round((covered.length / (covered.length + uncovered.length || 1)) * 100);
console.log(`\n${'─'.repeat(58)}`);
console.log(`${covered.length}/${covered.length + uncovered.length} testable events proven on a socket (${pct}%)`);
if (uncovered.length) {
  console.log('Each ✗ above is a path a user would experience as "I have to refresh".');
  process.exitCode = 1;
}
