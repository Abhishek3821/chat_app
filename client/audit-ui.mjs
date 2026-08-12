/**
 * Production readiness audit for the client.
 *
 * Catches the things a build and a test suite both miss but a user hits
 * immediately: a button wired to nothing, a hardcoded dev URL that 404s in
 * production, debug output shipped to real users.
 *
 * Run from /client:  node audit-ui.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('src');
const rel = (f) => path.relative('.', f).replace(/\\/g, '/');

const walk = (dir, test, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, test, out);
    else if (test(e.name)) out.push(p);
  }
  return out;
};

const jsx = walk(SRC, (n) => n.endsWith('.jsx'));
const all = walk(SRC, (n) => /\.(js|jsx)$/.test(n));
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

/**
 * Blank out comments while PRESERVING every byte offset and newline, so reported
 * line numbers stay correct.
 *
 * Needed because a comment that merely mentions `<button>` was being reported as
 * a real dead button — a scanner that flags its own documentation trains you to
 * ignore it, which is worse than not scanning.
 */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

let problems = 0;
const section = (t) => console.log(`\n── ${t} ──`);
const hit = (msg) => {
  console.log(`  ✗ ${msg}`);
  problems += 1;
};
const clean = (msg) => console.log(`  ✓ ${msg}`);

/* ── 1. Buttons with no way to activate them ───────────────────────── */
section('Interactive elements');
let deadButtons = 0;
for (const f of jsx) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  for (const m of src.matchAll(/<button\b([\s\S]*?)>/g)) {
    const attrs = m[1];
    // A button is fine if it has any activation path, or is a form submit, or
    // is a styled wrapper that forwards props via spread.
    if (/onClick|onMouseDown|onPointerDown|onKeyDown|onSubmit|type=["'{]?submit|form=|\{\.\.\./.test(attrs)) continue;
    hit(`${rel(f)}:${lineOf(src, m.index)} — <button> with no handler, submit type, or prop spread`);
    deadButtons += 1;
  }
}
if (!deadButtons) clean('every <button> has a handler, is a submit, or forwards props');

/* ── 2. Handlers that do nothing ───────────────────────────────────── */
let noops = 0;
for (const f of jsx) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  for (const m of src.matchAll(/on[A-Z]\w+=\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/g)) {
    hit(`${rel(f)}:${lineOf(src, m.index)} — handler is an empty function`);
    noops += 1;
  }
}
if (!noops) clean('no empty event handlers');

/* ── 3. Hardcoded dev URLs ─────────────────────────────────────────── */
section('Production configuration');
let hardcoded = 0;
for (const f of all) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  for (const m of src.matchAll(/["'`](https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?[^"'`]*)["'`]/g)) {
    // A localhost literal is legitimate inside a DEV-only branch or a comment
    // about dev behaviour; flag the rest, which would ship to production.
    const line = lineOf(src, m.index);
    const context = src.split('\n')[line - 1] || '';
    if (/import\.meta\.env\.DEV|DEV \?|\/\/|\*/.test(context)) continue;
    hit(`${rel(f)}:${line} — hardcoded ${m[1]}`);
    hardcoded += 1;
  }
}
if (!hardcoded) clean('no hardcoded localhost URLs outside dev-only branches');

/* ── 4. Debug output shipped to users ──────────────────────────────── */
let logs = 0;
for (const f of all) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  for (const m of src.matchAll(/\bconsole\.(log|debug|dir|table)\s*\(/g)) {
    /* Skip occurrences inside a template literal. The Developers page renders
       integration CODE SAMPLES as strings, and a `console.log` in a snippet we
       show the user is documentation, not debug output we ship. Counting backticks
       before this point is enough to tell the two apart. */
    const before = src.slice(0, m.index);
    const inTemplate = (before.match(/`/g) || []).length % 2 === 1;
    if (inTemplate) continue;
    hit(`${rel(f)}:${lineOf(src, m.index)} — console.${m[1]} left in shipped code`);
    logs += 1;
  }
}
if (!logs) clean('no console.log/debug in client source');

/* ── 5. Env vars the client reads, for the deploy checklist ────────── */
section('Environment variables the client requires');
const envVars = new Set();
for (const f of all) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  for (const m of src.matchAll(/import\.meta\.env\.(VITE_\w+)/g)) envVars.add(m[1]);
}
for (const v of [...envVars].sort()) console.log(`  · ${v}`);

/* ── 6. Routes declared vs pages that exist ────────────────────────── */
section('Routing');
const appSrc = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8');
const lazyImports = [...appSrc.matchAll(/import\(['"]\.\/([^'"]+)['"]\)/g)].map((m) => m[1]);
const eagerImports = [...appSrc.matchAll(/^import\s+\w+\s+from\s+['"]\.\/([^'"]+)['"]/gm)].map((m) => m[1]);
let missingPages = 0;
for (const spec of [...lazyImports, ...eagerImports]) {
  const p = path.join(SRC, spec);
  if (!fs.existsSync(p)) {
    hit(`App.jsx imports ./${spec} which does not exist`);
    missingPages += 1;
  }
}
if (!missingPages) clean(`all ${lazyImports.length + eagerImports.length} route component imports resolve`);

const routePaths = [...appSrc.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
console.log(`  · ${routePaths.length} routes declared: ${routePaths.join(' ')}`);

console.log(`\n${'─'.repeat(52)}`);
console.log(problems ? `${problems} issue(s) to review` : 'no issues found');
if (problems) process.exitCode = 1;
