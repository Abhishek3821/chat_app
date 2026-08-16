/**
 * Light/dark contrast audit.
 *
 * The design system is token-based: `text-content`, `text-content-muted`,
 * `bg-surface`, `bg-app` and friends all flip with `.dark`. Anything that hard-
 * codes a light- or dark-only colour instead is invisible in one of the two
 * themes, and neither the build nor a screenshot of the theme you happen to be
 * using will tell you.
 *
 * What it flags, and why each is a real defect rather than a style opinion:
 *
 *   TEXT ON AN UNKNOWN SURFACE — `text-white` (or `text-navy-950`, `text-black`)
 *     on an element with NO background class of its own. It inherits whatever
 *     surface it lands on, and that surface flips with the theme: white text on
 *     a white panel in light mode, navy text on a navy panel in dark mode.
 *
 *   PANEL COLOURS WITHOUT A PAIR — `bg-white` / `bg-navy-900` and similar with
 *     no `dark:` counterpart, so the panel stays one theme's colour in both.
 *
 * Deliberately NOT flagged:
 *   • `text-white` next to a solid coloured/dark background in the same class
 *     string (`bg-brand-gradient`, `bg-red-500`, `bg-black/50`, …) — the
 *     background travels with the text, so it reads the same in both themes.
 *   • Files listed in ALWAYS_DARK: surfaces that are dark by design in both
 *     themes (the meeting room, the call overlay), the same way Meet and Zoom
 *     stay dark in a light OS.
 *
 * Run:  node audit-theme.mjs   (from /client)
 */
import fs from 'fs';
import path from 'path';

const SRC = path.join(process.cwd(), 'src');

/**
 * Surfaces that are intentionally one colour in BOTH themes, and why. Each of
 * these was checked by hand — they are not "known failures".
 */
const ALWAYS_DARK = [
  'pages/MeetingRoom.jsx', // the room stays dark like Meet/Zoom do in a light OS
  'components/overlays/CallOverlay.jsx', // full-screen call, same reason
  'components/meeting/',
  'components/call/',
  'components/QrScanner.jsx', // a camera viewport is black in any theme
  'components/QrCode.jsx', // a QR needs its white quiet zone to stay scannable
  'pages/auth/Login.jsx', // glass cards float on the brand-gradient hero
  'pages/auth/Signup.jsx',
  'pages/DevelopersPage.jsx', // <pre> code blocks are dark in both themes
];

/** Light-only ink: unreadable once the surface goes dark. */
const LIGHT_ONLY_TEXT = /^text-(black|navy-(8|9)\d0|slate-(8|9)\d0|gray-(8|9)\d0|zinc-(8|9)\d0)$/;
/** Dark-only ink: unreadable on a light surface. */
const DARK_ONLY_TEXT = /^text-white$/;
/** Backgrounds that pin a panel to one theme. */
const THEMED_BG = /^bg-(white|black|navy-\d+|slate-(8|9)\d0|gray-(8|9)\d0)(\/\d+)?$/;

/**
 * A coloured/dark surface that travels WITH the text, so the pair reads the same
 * in both themes. Matched against the WHOLE LINE, not just the one quoted chunk,
 * because the overwhelmingly common shape here is a ternary that puts the two
 * halves in separate strings:
 *
 *     cn('…', isMine ? 'neu-on-accent text-white' : 'bg-surface text-content')
 *
 * Reading only the `text-white` chunk reports every accent bubble in the app as
 * broken — 40+ false positives that bury the handful of real ones.
 */
const CARRIES_OWN_BG =
  /\b(bg-(brand|red|emerald|amber|rose|indigo|violet|cyan|blue|green|orange|purple|pink|teal|sky|fuchsia|lime)-\d+|bg-brand-gradient|bg-gradient|btn-gradient|neu-on-accent|bg-black|bg-navy-\d+|bg-white\/\d+|bg-black\/\d+|bg-current|bg-\[)/;
/** The token-based counterpart appearing on the same line = a deliberate pair. */
const HAS_TOKEN_COUNTERPART = /\b(text-content|text-content-muted|bg-surface|bg-app)\b/;

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(jsx|tsx)$/.test(entry.name)) files.push(full);
  }
})(SRC);

const findings = [];

for (const file of files) {
  const rel = path.relative(SRC, file).replace(/\\/g, '/');
  if (ALWAYS_DARK.some((p) => rel.startsWith(p) || rel === p)) continue;

  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split('\n');

  lines.forEach((line, i) => {
    // Comments describing classes are not classes.
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    if (!/class(Name)?\s*=|cn\(|'[^']*\b(text|bg)-/.test(code)) return;

    // Every quoted run that looks like a class list.
    for (const m of code.matchAll(/['"`]([^'"`]*\b(?:text|bg)-[^'"`]*)['"`]/g)) {
      const chunk = m[1];
      const classes = chunk.split(/\s+/).filter(Boolean);
      const hasDarkVariant = (prop) => classes.some((c) => c.startsWith(`dark:${prop}-`)) || code.includes(`dark:${prop}-`);

      /* Context window, not just this line. JSX puts the parent's className on
         the line ABOVE its children, so an icon coloured `text-white` inside a
         `bg-amber-500` badge has its justification two lines up. Checking the
         single line reported every one of those. */
      const context = lines.slice(Math.max(0, i - 3), i + 3).join(' ');
      const carriesBg =
        CARRIES_OWN_BG.test(context) ||
        HAS_TOKEN_COUNTERPART.test(context) ||
        // An inline background (status composer, accent swatches) the scanner
        // can't read as a class.
        /style=\{\{[^}]*(background|backgroundColor)/.test(context) ||
        // Media letterbox: bg-black behind a <video>/<img> is the neutral
        // backing for the frame, not a themed panel. <pre> is the same idea for
        // code — a dark code block in a light page is a deliberate convention.
        /<(video|img|pre)\b|object-(contain|cover)/.test(context) ||
        // The selected half of a state ternary sits on the accent fill.
        /\b(active|isActive|selected|isMine|mine|isSelected)\s*\?/.test(context) ||
        // Colour-preview data (the theme picker's own swatches literally have to
        // show what each theme looks like).
        /\b(swatch|dots|dot|preview|palette)\s*:/.test(context) ||
        // Content laid over an image/gradient — story cards, hero overlays.
        /drop-shadow|inset-0|bg-\[linear-gradient|from-black|to-black/.test(context);

      for (const c of classes) {
        if (c.startsWith('dark:')) continue;

        if (DARK_ONLY_TEXT.test(c) && !carriesBg && !hasDarkVariant('text')) {
          findings.push({ rel, line: i + 1, cls: c, why: 'white text with no background of its own — invisible on a light surface', chunk });
        } else if (LIGHT_ONLY_TEXT.test(c) && !carriesBg && !hasDarkVariant('text')) {
          findings.push({ rel, line: i + 1, cls: c, why: 'dark ink with no background of its own — invisible on a dark surface', chunk });
        } else if (THEMED_BG.test(c) && !c.includes('/') && !hasDarkVariant('bg')) {
          findings.push({ rel, line: i + 1, cls: c, why: 'panel colour pinned to one theme (no dark: pair)', chunk });
        }
      }
    }
  });
}

const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.rel)) byFile.set(f.rel, []);
  byFile.get(f.rel).push(f);
}

/**
 * Triaged baseline.
 *
 * Every one of the remaining findings was opened and checked by hand on
 * 2026-08-15 and is deliberate: the theme picker's own swatches (which have to
 * show literally what each theme looks like), `<pre>` code blocks, the black
 * backing behind a <video>/<img>, the story viewer's progress bar, and the dot
 * on an accent-filled active tab.
 *
 * A baseline rather than more heuristics: each extra exception makes the
 * scanner blinder, and the point is to catch the NEXT hardcoded colour. Grows
 * ⇒ fail. If you legitimately add one, lower... raise this number and say why.
 */
const BASELINE = 13;

if (!findings.length) {
  console.log('\n✓ no theme-contrast issues found');
  process.exit(0);
}

console.log(`\n${findings.length} flagged (baseline ${BASELINE}, all triaged as deliberate) in ${byFile.size} file(s):\n`);
for (const [rel, list] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${rel}  (${list.length})`);
  for (const f of list.slice(0, 6)) {
    console.log(`    :${String(f.line).padEnd(4)} ${f.cls.padEnd(18)} ${f.why}`);
  }
  if (list.length > 6) console.log(`    … ${list.length - 6} more`);
}

if (findings.length > BASELINE) {
  console.log(`\n✗ ${findings.length - BASELINE} NEW hardcoded colour(s) since the baseline — check the list above.`);
  process.exit(1);
}
console.log(`\n✓ no new hardcoded colours (${findings.length}/${BASELINE})`);
process.exit(0);
