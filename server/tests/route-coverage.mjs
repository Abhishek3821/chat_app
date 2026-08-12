/**
 * Static audit: does every API call the CLIENT makes hit a route the SERVER
 * actually defines?
 *
 * This is the check that catches a whole class of production bug the test suites
 * miss — a button wired to an endpoint that was renamed, moved or never built.
 * Those fail as a 404 at runtime, in front of a user, and no amount of unit
 * testing the server finds them because the server is fine; it is the CLIENT's
 * assumption that is wrong.
 *
 * Method: parse every `api.<verb>('<path>')` out of client/src, parse every
 * `router.<verb>('<path>')` out of server/routes plus its mount prefix, then
 * match with path params normalised to a wildcard.
 *
 * Run:  node tests/route-coverage.mjs   (from /server)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const CLIENT_SRC = path.resolve(SERVER_DIR, '..', 'client', 'src');

const walk = (dir, test, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, test, out);
    else if (test(e.name)) out.push(p);
  }
  return out;
};

/* Routers mounted in index.js that this script could not trace back to a file.
   Reported loudly: an unresolved router means its routes are invisible here. */
const unmountedWarnings = [];

/* ── 1. Server: mount prefixes ─────────────────────────────────────── */
const indexSrc = fs.readFileSync(path.join(SERVER_DIR, 'routes', 'index.js'), 'utf8');
const mounts = new Map(); // imported identifier -> { file, prefix }

// Default imports:  import chatRoutes from './chatRoutes.js'
for (const m of indexSrc.matchAll(/import\s+(\w+)\s+from\s+'\.\/([\w.]+\.js)'/g)) mounts.set(m[1], { file: m[2] });
/* NAMED imports:  import { webhookRoutes, hookIngressRoutes } from './webhookRoutes.js'
   Missing these is not a false positive, it is a SILENT GAP: the whole file goes
   unscanned, so every call into it is reported as unmatched (or worse, a genuinely
   missing route hides among them). */
for (const m of indexSrc.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([\w.]+\.js)'/g)) {
  for (const name of m[1].split(',')) {
    const id = name.trim().split(/\s+as\s+/).pop().trim();
    if (id) mounts.set(id, { file: m[2] });
  }
}
for (const m of indexSrc.matchAll(/router\.use\(\s*'([^']+)'\s*,\s*(\w+)\s*\)/g)) {
  const entry = mounts.get(m[2]);
  if (entry) entry.prefix = m[1];
  else unmountedWarnings.push(`router.use('${m[1]}', ${m[2]}) — could not resolve ${m[2]} to a file`);
}

/* ── 2. Server: declared routes ────────────────────────────────────── */
const declared = []; // { method, pattern }
for (const [, entry] of mounts) {
  if (!entry.prefix || !entry.file) continue;
  const file = path.join(SERVER_DIR, 'routes', entry.file);
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, 'utf8');

  /* Any identifier, not just `router` — several files name their router after
     what it is (`webhookRoutes.get(...)`, `hookIngressRoutes.post(...)`), and
     hard-coding `router` skipped them entirely. */
  for (const m of src.matchAll(/\b\w+\s*\.\s*(get|post|put|patch|delete)\s*\(\s*'([^']*)'/g)) {
    declared.push({ method: m[1].toUpperCase(), pattern: joinPath(entry.prefix, m[2]) });
  }
  // <router>.route('/x').get(...).post(...)
  for (const m of src.matchAll(/\b\w+\s*\.\s*route\s*\(\s*'([^']*)'\s*\)((?:\s*\.\s*\w+\([^)]*\))+)/g)) {
    for (const v of m[2].matchAll(/\.\s*(get|post|put|patch|delete)\s*\(/g)) {
      declared.push({ method: v[1].toUpperCase(), pattern: joinPath(entry.prefix, m[1]) });
    }
  }
}

function joinPath(prefix, sub) {
  const a = prefix.replace(/\/$/, '');
  const b = sub === '/' ? '' : sub;
  return (a + b) || '/';
}

/** `/messages/:id/star` → `^/messages/[^/]+/star$` */
const toRegex = (pattern) =>
  new RegExp(
    `^${pattern
      .split('/')
      .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('/')}$`
  );
const declaredMatchers = declared.map((d) => ({ ...d, re: toRegex(d.pattern) }));

/* ── 3. Client: calls made ─────────────────────────────────────────── */
const clientFiles = walk(CLIENT_SRC, (n) => /\.(js|jsx)$/.test(n));
const calls = [];
for (const file of clientFiles) {
  const src = fs.readFileSync(file, 'utf8');
  // api.get('/x'), api.post(`/x/${id}`), api.delete('/x')
  for (const m of src.matchAll(/\bapi\s*\.\s*(get|post|put|patch|delete)\s*\(\s*([`'"])([^`'"]+)\2/g)) {
    let p = m[3];
    if (!p.startsWith('/')) continue; // absolute/external URL
    // `${...}` interpolations become a single wildcard segment
    p = p.replace(/\$\{[^}]*\}/g, ':param');
    p = p.split('?')[0].replace(/\/$/, '') || '/';
    calls.push({
      method: m[1].toUpperCase(),
      pattern: p,
      where: `${path.relative(CLIENT_SRC, file).replace(/\\/g, '/')}:${src.slice(0, m.index).split('\n').length}`,
    });
  }
}

/* ── 4. Match ──────────────────────────────────────────────────────── */
const unmatched = [];
for (const c of calls) {
  const concrete = c.pattern.replace(/:param/g, 'X');
  const hit = declaredMatchers.some((d) => d.method === c.method && d.re.test(concrete));
  if (!hit) unmatched.push(c);
}

// De-duplicate: the same call from several files is one problem.
const seen = new Set();
const unique = unmatched.filter((u) => {
  const k = `${u.method} ${u.pattern}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

console.log(`server declares ${declared.length} routes across ${mounts.size} routers`);
console.log(`client makes    ${calls.length} API calls (${new Set(calls.map((c) => `${c.method} ${c.pattern}`)).size} distinct)\n`);

for (const w of unmountedWarnings) console.log(`⚠ ${w}`);

if (unique.length === 0) {
  console.log('✓ every client API call matches a declared server route');
  process.exit(unmountedWarnings.length ? 1 : 0);
}

console.log(`✗ ${unique.length} client call(s) with no matching server route:\n`);
for (const u of unique) console.log(`  ${u.method.padEnd(6)} ${u.pattern}\n         called from ${u.where}`);
process.exit(1);
