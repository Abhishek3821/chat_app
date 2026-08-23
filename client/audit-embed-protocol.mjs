/**
 * The embed postMessage protocol must match on BOTH sides.
 *
 * Every integration failure on this project so far has been the same shape: a
 * name that matches on one side only, failing silently with no error anywhere.
 * `receiverId` vs `to`, `call:end` vs `call:ended`, `join-chat` given an object
 * instead of a string, `participants` vs `members`. The embed adds a third
 * surface — postMessage between `public/embed.js` (the host's loader) and
 * `src/EmbedApp.jsx` (the framed app) — with exactly the same failure mode: a
 * dropped message looks identical to a feature that does not work.
 *
 * So it is pinned statically. A message either side sends must be handled by the
 * other, and the two `source` tags must agree.
 *
 * Run from /client:  node audit-embed-protocol.mjs
 */
import fs from 'node:fs';

const LOADER = 'public/embed.js';
const EMBED = 'src/EmbedApp.jsx';

const loader = fs.readFileSync(LOADER, 'utf8');
const embed = fs.readFileSync(EMBED, 'utf8');

const uniq = (a) => [...new Set(a)];
const matchAll = (src, re) => uniq([...src.matchAll(re)].map((m) => m[1]));

/* host → embed: loader calls send({ type: 'x' }); embed tests msg.type === 'x' */
const hostSends = matchAll(loader, /send\(\{\s*type:\s*'([a-z-]+)'/g);
const embedHandles = matchAll(embed, /msg\.type\s*===\s*'([a-z-]+)'/g);

/* embed → host: embed calls post({ type: 'x' }); loader switches on case 'x' */
const embedSends = matchAll(embed, /post\(\{\s*type:\s*'([a-z-]+)'/g);
const hostHandles = matchAll(loader, /case\s*'([a-z-]+)':/g);

/* The `source` tag both sides stamp and verify. A mismatch here silently drops
   every message in that direction. */
const tagOf = (src, name) => {
  const m = src.match(new RegExp(`${name}\\s*=\\s*'([a-z-]+)'`));
  return m ? m[1] : null;
};
const loaderEmbedTag = tagOf(loader, 'EMBED');
const loaderHostTag = tagOf(loader, 'HOST');
const embedEmbedTag = tagOf(embed, 'EMBED');
const embedHostTag = tagOf(embed, 'HOST');

const problems = [];

for (const t of hostSends) {
  if (!embedHandles.includes(t)) {
    problems.push(`${LOADER} sends "${t}" but ${EMBED} never handles it — the host would post into the void.`);
  }
}
for (const t of embedSends) {
  if (!hostHandles.includes(t)) {
    problems.push(`${EMBED} sends "${t}" but ${LOADER} has no case for it — the host would never react.`);
  }
}
if (!loaderEmbedTag || !embedEmbedTag || loaderEmbedTag !== embedEmbedTag) {
  problems.push(`EMBED source tag differs: ${LOADER}="${loaderEmbedTag}" vs ${EMBED}="${embedEmbedTag}".`);
}
if (!loaderHostTag || !embedHostTag || loaderHostTag !== embedHostTag) {
  problems.push(`HOST source tag differs: ${LOADER}="${loaderHostTag}" vs ${EMBED}="${embedHostTag}".`);
}

/* Two invariants that are security properties, not naming: the token must never
   be put in the iframe URL, and neither side may post to a wildcard origin. */
if (/[?&]token=/.test(loader)) {
  problems.push(`${LOADER} puts a token in the iframe URL — it would leak via history, logs and Referer.`);
}
for (const [file, src] of [
  [LOADER, loader],
  [EMBED, embed],
]) {
  if (/postMessage\([^)]*,\s*['"]\*['"]\s*\)/.test(src)) {
    problems.push(`${file} posts to '*' — that broadcasts session state to any framing page.`);
  }
}

console.log(`host → embed : sends [${hostSends.join(', ')}]  handled [${embedHandles.join(', ')}]`);
console.log(`embed → host : sends [${embedSends.join(', ')}]  handled [${hostHandles.join(', ')}]`);
console.log('');

if (!problems.length) {
  console.log('✓ embed postMessage protocol matches on both sides');
  console.log('  (token is not in the URL; neither side posts to a wildcard origin)');
  process.exit(0);
}

console.log(`✗ ${problems.length} embed protocol problem(s):\n`);
problems.forEach((p) => console.log(`  · ${p}`));
process.exitCode = 1;
