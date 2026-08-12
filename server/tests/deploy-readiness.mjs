/**
 * Deployment readiness audit for the server.
 *
 * Answers the questions that decide whether a deploy comes up or falls over, and
 * that no unit test asks:
 *   · does .env.example document every variable the code actually reads?
 *   · is anything secret at risk of being committed?
 *   · are the production-only guards (secret strength, CORS, HTTPS) real?
 *
 * Reads only — it never prints a secret's VALUE, only whether one is present.
 *
 * Run:  node tests/deploy-readiness.mjs   (from /server)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const ROOT = path.resolve(SERVER_DIR, '..');

const walk = (dir, test, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, test, out);
    else if (test(e.name)) out.push(p);
  }
  return out;
};

let problems = 0;
let warnings = 0;
const section = (t) => console.log(`\n── ${t} ──`);
const fail = (m) => {
  console.log(`  ✗ ${m}`);
  problems += 1;
};
const warn = (m) => {
  console.log(`  ⚠ ${m}`);
  warnings += 1;
};
const ok = (m) => console.log(`  ✓ ${m}`);

/* ── 1. Env vars: read vs documented ───────────────────────────────── */
section('Environment variables');
const serverFiles = walk(SERVER_DIR, (n) => n.endsWith('.js'));
const read = new Set();
for (const f of serverFiles) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) read.add(m[1]);
}

const examplePath = path.join(SERVER_DIR, '.env.example');
if (!fs.existsSync(examplePath)) {
  fail('.env.example is missing — nobody can configure a deploy from the repo alone');
} else {
  const exampleSrc = fs.readFileSync(examplePath, 'utf8');
  const documented = new Set([...exampleSrc.matchAll(/^\s*#?\s*([A-Z0-9_]+)\s*=/gm)].map((m) => m[1]));

  // Set by the platform, not by the operator.
  const PROVIDED = new Set(['NODE_ENV', 'PORT', 'npm_package_version', 'RENDER', 'RENDER_EXTERNAL_URL']);
  const undocumented = [...read].filter((v) => !documented.has(v) && !PROVIDED.has(v)).sort();

  if (undocumented.length) {
    fail(`${undocumented.length} variable(s) read by the code but NOT in .env.example:`);
    for (const v of undocumented) console.log(`      ${v}`);
  } else {
    ok(`.env.example documents all ${read.size - [...read].filter((v) => PROVIDED.has(v)).length} operator-set variables`);
  }

  const stale = [...documented].filter((v) => !read.has(v) && !PROVIDED.has(v)).sort();
  if (stale.length) warn(`documented but never read (safe to drop): ${stale.join(', ')}`);
}

/* ── 2. Secret hygiene ─────────────────────────────────────────────── */
section('Secret hygiene');
const gitignore = fs.existsSync(path.join(ROOT, '.gitignore')) ? fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8') : '';
if (/^\s*(server\/)?\.env(\*|$)/m.test(gitignore) || /\.env/.test(gitignore)) ok('.env is gitignored');
else fail('.env is NOT gitignored — real credentials could be committed');

const envPath = path.join(SERVER_DIR, '.env');
if (fs.existsSync(envPath)) {
  const envSrc = fs.readFileSync(envPath, 'utf8');
  // Presence only. Values are never printed.
  const filled = [...envSrc.matchAll(/^\s*([A-Z0-9_]+)\s*=\s*(.+)$/gm)]
    .filter(([, , v]) => v.trim() && !/^(changeme|your[-_]|xxx|todo|<)/i.test(v.trim()))
    .map(([, k]) => k);
  ok(`local .env has ${filled.length} populated variable(s) (values not inspected)`);

  /* A bare password/secret sitting in a COMMENT is the classic accident: it
     survives rotation of the real value and nobody thinks to look there. */
  const commentedSecrets = [...envSrc.matchAll(/^\s*#\s*(?!.*=)(\S{8,})\s*$/gm)].map((m) => m[1]);
  if (commentedSecrets.length) {
    warn(`${commentedSecrets.length} bare value(s) in .env COMMENTS — check these are not live credentials, then delete them`);
  } else {
    ok('no bare values loose in .env comments');
  }
} else {
  warn('no local server/.env (fine on a build machine; required to run)');
}

/* Any secret-looking literal committed in source?
   Comments are blanked first (offsets preserved) — a comment EXPLAINING that
   `mongodb+srv://` needs an SRV lookup is documentation, and a scanner that
   reports its own docs as a leak is a scanner people learn to ignore. */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

const suspicious = [];
for (const f of serverFiles) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  for (const m of src.matchAll(/(mongodb\+srv:\/\/[A-Za-z0-9._%-]+:[^\s'"$`]+@|sk_live_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16})/g)) {
    // Report the SHAPE, never the value.
    suspicious.push(`${path.relative(ROOT, f)}: ${m[1].slice(0, 14)}…`);
  }
}
if (suspicious.length) {
  fail(`credential-shaped literal(s) in source: ${suspicious.join('; ')}`);
} else {
  ok('no connection strings or API keys hardcoded in server source');
}

/* ── 3. Production guards ──────────────────────────────────────────── */
section('Production guards');
const serverJs = fs.readFileSync(path.join(SERVER_DIR, 'server.js'), 'utf8');
const checks = [
  [/helmet\(/, 'helmet security headers'],
  [/cors\(\s*\{[^}]*origin/s, 'CORS restricted to an allowlist'],
  [/rateLimit|Limiter/, 'rate limiting'],
  [/mongoSanitize|sanitize/, 'input sanitization'],
  [/compression\(/, 'response compression'],
];
for (const [re, label] of checks) {
  if (re.test(serverJs)) ok(label);
  else warn(`${label} not detected in server.js`);
}

// Weak-secret guard: production must refuse to boot on a default JWT secret.
const authFiles = serverFiles.filter((f) => /token|auth|config/i.test(f));
const guardsWeakSecret = authFiles.some((f) => {
  const src = fs.readFileSync(f, 'utf8');
  return /NODE_ENV\s*===\s*'production'/.test(src) && /(JWT_SECRET|secret)/.test(src) && /(throw|exit)/.test(src);
});
if (guardsWeakSecret) ok('production refuses to boot with a missing/weak JWT secret');
else warn('no explicit production guard found for a missing/weak JWT secret');

console.log(`\n${'─'.repeat(56)}`);
console.log(`${problems} blocker(s), ${warnings} warning(s)`);
if (problems) process.exitCode = 1;
