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
 * Only the SIMD build is copied. The nosimd fallback doubles the payload for
 * browsers that haven't existed for years, and the app already requires
 * WebRTC + WebCodecs-era APIs well beyond that baseline.
 *
 * public/mediapipe/ is gitignored — it is a build artifact reproduced from
 * node_modules, not source. Runs from `predev` and `prebuild`.
 */
import fs from 'fs';
import path from 'path';

const FROM = path.join(process.cwd(), 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const TO = path.join(process.cwd(), 'public', 'mediapipe');
const NEEDED = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm'];

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
