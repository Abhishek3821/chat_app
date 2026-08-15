/**
 * Dead-button audit at the PROP level.
 *
 * `audit-ui.mjs` catches a `<button>` with no handler at all. This catches the
 * subtler and more common failure: a button wired to a handler PROP that the
 * parent never passes.
 *
 *   function Row({ onRemove }) { ... <button onClick={onRemove}>Remove</button> }
 *   <Row user={u} />          ← onRemove undefined: the button renders and does nothing
 *
 * Nothing throws, nothing logs, the build passes and the UI looks complete. The
 * project already had one of these (a Section `action` prop rendered inside a
 * handler-less <button>), which is what prompted this.
 *
 * Method: for every locally-defined component, collect the `on*` props it
 * destructures AND actually attaches to something clickable. Then find every JSX
 * usage of that component and report any such prop that usage omits.
 *
 * Run from /client:  node audit-buttons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('src');
const rel = (f) => path.relative('.', f).replace(/\\/g, '/');

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.jsx')) out.push(p);
  }
  return out;
};

/** Blank comments, preserving offsets so line numbers stay true. */
const strip = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

const lineOf = (src, i) => src.slice(0, i).split('\n').length;

const files = walk(SRC);

/* ── 1. Component definitions and their interactive handler props ──── */
/**
 * Keyed by `file::Name`, NOT by name alone.
 *
 * A single global map conflates same-named components in different files —
 * MeetingsPage has its own `TypeChip({ type, compact })` with no handlers, and
 * ModalHost a different `TypeChip({ active, onClick })`. Keying by name reported
 * the innocent one as broken. A definition applies to its own file, or to a file
 * that imports it from there.
 */
const components = new Map();
/** file -> Map(importedName -> definingFile) */
const importsByFile = new Map();

for (const f of files) {
  const src = strip(fs.readFileSync(f, 'utf8'));
  // function Foo({ a, b }) …  /  const Foo = ({ a, b }) =>
  const defRe = /(?:function\s+([A-Z]\w*)\s*\(\s*\{([^}]*)\}|const\s+([A-Z]\w*)\s*=\s*(?:memo\s*\(\s*)?\(\s*\{([^}]*)\})/g;
  for (const m of src.matchAll(defRe)) {
    const name = m[1] || m[3];
    const propsRaw = m[2] || m[4] || '';
    if (!name) continue;

    const props = new Set(
      propsRaw
        .split(',')
        .map((p) => p.split('=')[0].split(':')[0].trim().replace(/^\.\.\./, ''))
        .filter((p) => /^on[A-Z]\w*$/.test(p))
    );
    if (!props.size) continue;

    /* Which of those are OPTIONAL by construction? `onX?.()` and `onX ?? noop`
       say the author expects absence, so omitting them is a deliberate choice,
       not a dead control. Only a bare attach is a problem. */
    const body = src.slice(m.index, findBodyEnd(src, m.index));
    const optional = new Set([...props].filter((p) => new RegExp(`\\b${p}\\s*(\\?\\.|\\?\\?)`).test(body)));

    /**
     * Which are attached to something a user can activate?
     *
     * Matched by looking for the prop ANYWHERE inside a handler attribute's value,
     * because handlers are routinely wrapped rather than passed bare:
     *     onClick={stop(onRemove)}        ← a stopPropagation helper
     *     onClick={() => onPin(m, hours)}
     *     onSubmit={handleWith(onSave)}
     * An earlier version only matched `onClick={onRemove}` and so considered
     * `onRemove` non-interactive — which made the whole audit blind to the exact
     * dead button it was written to find. Verified by deliberately deleting a
     * handler and confirming it is now reported.
     */
    const handlerValues = [];
    for (const h of body.matchAll(/on[A-Z]\w*\s*=\s*\{/g)) {
      const inner = readBracedValue(body, h.index + h[0].length);
      if (inner !== null) handlerValues.push(inner);
    }
    const attachedText = handlerValues.join('\n');
    const interactive = new Set([...props].filter((p) => new RegExp(`\\b${p}\\b`).test(attachedText)));

    components.set(`${f}::${name}`, { name, file: f, props, interactive, optional });
  }
}

/* Resolve local component imports so a definition can be matched to usages in
   other files — `import ContactRow from './ContactRow.jsx'` and named forms. */
for (const f of files) {
  const src = strip(fs.readFileSync(f, 'utf8'));
  const map = new Map();
  for (const m of src.matchAll(/import\s+(?:(\w+)|\{([^}]+)\})\s+from\s+'([^']+)'/g)) {
    const spec = m[3];
    if (!spec.startsWith('.') && !spec.startsWith('@/')) continue; // package, not ours
    const resolved = resolveSpec(f, spec);
    if (!resolved) continue;
    const names = m[1] ? [m[1]] : m[2].split(',').map((n) => n.trim().split(/\s+as\s+/).pop().trim());
    for (const n of names) if (/^[A-Z]/.test(n)) map.set(n, resolved);
  }
  importsByFile.set(f, map);
}

/** Read a `{...}` value, starting just after the opening brace. Brace-balanced. */
function readBracedValue(src, from) {
  let depth = 1;
  for (let i = from; i < src.length; i += 1) {
    const c = src[i];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(from, i);
    }
  }
  return null;
}

/**
 * Read a JSX opening tag's attribute text, starting just after the tag name.
 *
 * Tracks `{}` depth and quotes so a `>` inside an arrow function, a generic, or a
 * string does not end the tag early. Returns null if the tag never closes.
 */
function readTagAttrs(src, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === quote && src[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) return src.slice(from, i);
  }
  return null;
}

function resolveSpec(fromFile, spec) {
  const base = spec.startsWith('@/') ? path.join(SRC, spec.slice(2)) : path.resolve(path.dirname(fromFile), spec);
  for (const cand of [base, `${base}.jsx`, `${base}.js`, path.join(base, 'index.jsx')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

/** Rough end of a component body: the next top-level `function`/`const X = (`. */
function findBodyEnd(src, from) {
  const next = src.slice(from + 1).search(/\n(?:export\s+)?(?:function\s+[A-Z]|const\s+[A-Z]\w*\s*=\s*(?:memo\s*\()?\()/);
  return next === -1 ? src.length : from + 1 + next;
}

/* ── 2. Every JSX usage, and which on* props it passes ─────────────── */
let problems = 0;
const findings = [];

for (const f of files) {
  const src = strip(fs.readFileSync(f, 'utf8'));
  const imported = importsByFile.get(f) || new Map();

  for (const [, def] of components) {
    // Only components whose interactive handlers matter.
    if (!def.interactive.size) continue;
    /* Scope: the definition applies here only if it IS this file, or this file
       imports that name from the defining file. Otherwise a same-named component
       elsewhere would be audited against the wrong contract. */
    const sameFile = def.file === f;
    const viaImport = imported.get(def.name) === def.file;
    if (!sameFile && !viaImport) continue;

    const name = def.name;
    /* Find the tag's opening only; its END is located by scanning with BRACE
       DEPTH, because a JSX attribute routinely contains `>`:
           onUnpin={(messageId) => unpinMessage(chatId, messageId)}
       A `[^>]*` capture stops at the arrow and never sees the later props, which
       reported perfectly-wired components as dead. */
    const useRe = new RegExp(`<${name}(?=[\\s/>])`, 'g');
    for (const m of src.matchAll(useRe)) {
      const attrs = readTagAttrs(src, m.index + m[0].length);
      if (attrs === null) continue;
      // A spread may forward anything; treat it as satisfying everything.
      if (/\{\.\.\./.test(attrs)) continue;
      const missing = [...def.interactive].filter((p) => !def.optional.has(p) && !new RegExp(`\\b${p}\\s*=`).test(attrs));
      if (missing.length) {
        findings.push({
          where: `${rel(f)}:${lineOf(src, m.index)}`,
          component: name,
          defined: rel(def.file),
          missing,
        });
        problems += 1;
      }
    }
  }
}

console.log(`Scanned ${files.length} JSX files · ${components.size} components take on* props\n`);

if (!findings.length) {
  console.log('✓ every interactive handler prop is supplied at every usage site');
  console.log('  (a control wired to an omitted prop would render and silently do nothing)');
  process.exit(0);
}

console.log(`✗ ${findings.length} usage(s) omit a handler the component attaches to a control:\n`);
for (const x of findings) {
  console.log(`  ${x.where}`);
  console.log(`      <${x.component}> is missing: ${x.missing.join(', ')}`);
  console.log(`      defined in ${x.defined}`);
}
console.log('\nEach of these renders a control that does nothing when clicked.');
process.exitCode = 1;
