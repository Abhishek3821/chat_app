/**
 * Stage the MediaPipe vision runtime into public/ so it is served from OUR OWN
 * origin.
 *
 * Two reasons it can't just load from MediaPipe's CDN:
 *   • the deployed Content-Security-Policy is `script-src 'self'` (vercel.json),
 *     so a CDN-hosted worker script is blocked outright;
 *   • a video call that stops working because someone else's CDN is having a bad
 *     day is not a trade worth making.
 *
 * BOTH the SIMD and the nosimd build are copied, and that is not optional.
 * MediaPipe picks the filename from a runtime feature test:
 *
 *     `${base}/vision_wasm${simd ? '' : '_nosimd'}_internal.js`
 *
 * so the moment that test returns false — an older browser, or simply a
 * Content-Security-Policy that blocks WebAssembly compilation — it requests the
 * nosimd pair. Shipping only the SIMD build turned that into a 404 and the
 * feature died with an unhelpful error. Half the payload is not worth a
 * failure mode nobody can diagnose from the outside.
 *
 * public/mediapipe/ is gitignored — it is a build artifact reproduced from
 * node_modules, not source. Runs from `predev` and `prebuild`.
 */
import fs from 'fs';
import path from 'path';

const FROM = path.join(process.cwd(), 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const TO = path.join(process.cwd(), 'public', 'mediapipe');
const NEEDED = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

if (!fs.existsSync(FROM)) {
  console.warn('[mediapipe] @mediapipe/tasks-vision is not installed — background blur will report itself unavailable.');
  process.exit(0);
}

fs.mkdirSync(TO, { recursive: true });
let copied = 0;
for (const file of NEEDED) {
  const src = path.join(FROM, file);
  const dest = path.join(TO, file);
  if (!fs.existsSync(src)) {
    console.warn(`[mediapipe] missing ${file} in node_modules — skipping.`);
    continue;
  }
  // Skip an identical copy so `npm run dev` doesn't rewrite 12MB on every start.
  if (fs.existsSync(dest) && fs.statSync(dest).size === fs.statSync(src).size) continue;
  fs.copyFileSync(src, dest);
  copied += 1;
}
console.log(copied ? `[mediapipe] staged ${copied} runtime file(s) into public/mediapipe/` : '[mediapipe] runtime already staged');
