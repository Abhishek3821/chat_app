/**
 * List every environment variable the code actually reads, with where it is read.
 *
 * The source of truth for `.env.example`: a hand-maintained list drifts, and a
 * missing variable is a deploy that boots and then fails at the first request
 * that needs it. `deploy-readiness.mjs` asserts the two stay in sync; this prints
 * the list so the example file can be rewritten from it.
 *
 * Run:  node tests/list-env.mjs           (server vars)
 *       node tests/list-env.mjs --client  (VITE_* vars)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const CLIENT_SRC = path.resolve(SERVER_DIR, '..', 'client', 'src');

const CLIENT = process.argv.includes('--client');
const ROOT = CLIENT ? CLIENT_SRC : SERVER_DIR;
const EXT = CLIENT ? /\.(js|jsx)$/ : /\.js$/;

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.test(e.name)) out.push(p);
  }
  return out;
};

const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const found = new Map(); // name -> Set(files)

for (const f of walk(ROOT)) {
  const src = fs.readFileSync(f, 'utf8');
  const re = CLIENT ? /import\.meta\.env\.(VITE_[A-Z0-9_]+)/g : /process\.env\.([A-Z0-9_]+)/g;
  for (const m of src.matchAll(re)) {
    if (!found.has(m[1])) found.set(m[1], new Set());
    found.get(m[1]).add(rel(f));
  }
}

console.log(`${CLIENT ? 'CLIENT' : 'SERVER'} reads ${found.size} variables:\n`);
for (const name of [...found.keys()].sort()) {
  const where = [...found.get(name)];
  console.log(`${name.padEnd(30)} ${where.slice(0, 3).join(', ')}${where.length > 3 ? ` (+${where.length - 3} more)` : ''}`);
}
