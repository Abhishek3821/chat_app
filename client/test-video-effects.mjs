/**
 * Background-effects preflight, run in node against a real HTTP server.
 *
 * There is no browser here, so this cannot prove segmentation renders. What it
 * CAN prove is every reason the feature actually failed in the field, each of
 * which is a plain fact about files and headers:
 *
 *   1. both wasm variants are served — MediaPipe picks the filename from a
 *      runtime SIMD test, so shipping only the SIMD pair 404s the other half;
 *   2. the .wasm files carry `application/wasm`, or instantiation refuses them;
 *   3. the model is served and is a real TFLite file;
 *   4. the deployed CSP permits WebAssembly at all.
 *
 * Run:  node test-video-effects.mjs   (from /client, after `npm run build`)
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
const check = (name, cond, detail = '') => {
  results.push(!!cond);
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || !detail ? '' : `  — ${detail}`}`);
};
const section = (t) => console.log(`\n— ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Static facts, no server needed ─────────────────────────────────── */
section('The build output contains what the runtime asks for');

const WASM_VARIANTS = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];
for (const f of WASM_VARIANTS) {
  check(`dist/mediapipe/${f}`, fs.existsSync(path.join('dist', 'mediapipe', f)));
}
check('dist/models/selfie_segmenter.tflite', fs.existsSync(path.join('dist', 'models', 'selfie_segmenter.tflite')));

const model = fs.existsSync('dist/models/selfie_segmenter.tflite')
  ? fs.readFileSync('dist/models/selfie_segmenter.tflite')
  : Buffer.alloc(0);
check('the model is a real TFLite file (TFL3 magic)', model.subarray(4, 8).toString() === 'TFL3', model.subarray(4, 8).toString());

section('The deployed Content-Security-Policy permits WebAssembly');
const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const csp = JSON.stringify(vercel.headers).match(/script-src [^;"]*/)?.[0] || '';
/* Chrome refuses to compile ANY WebAssembly without this, including MediaPipe's
   own SIMD feature test — which then reports "no SIMD" and requests a different
   filename, so the visible symptom is a 404 rather than a CSP error. */
check("script-src includes 'wasm-unsafe-eval'", csp.includes("'wasm-unsafe-eval'"), csp);
check("script-src still restricts to 'self'", csp.includes("'self'"), csp);

section('The client keeps the 12MB runtime out of the initial bundle');
const assets = fs.readdirSync('dist/assets');
const entry = assets.find((f) => /^index-.*\.js$/.test(f));
const entrySrc = fs.readFileSync(path.join('dist/assets', entry), 'utf8');
check('the entry chunk does not inline the segmenter', !/ImageSegmenter|FilesetResolver/.test(entrySrc));
check('it is code-split into its own chunk', assets.some((f) => /vision_bundle/.test(f)), assets.filter((f) => f.endsWith('.js')).length + ' chunks');

/* ── Served over HTTP, with the headers a browser will see ──────────── */
section('Everything is reachable, with the MIME types WebAssembly requires');
const preview = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  shell: process.platform === 'win32',
});
let up = false;
for (let i = 0; i < 40; i += 1) {
  try { await fetch(`${BASE}/`); up = true; break; } catch { await sleep(500); }
}
if (!up) {
  console.error('preview server did not start');
  preview.kill();
  process.exit(1);
}

for (const f of WASM_VARIANTS) {
  const res = await fetch(`${BASE}/mediapipe/${f}`);
  const ct = res.headers.get('content-type') || '';
  const wantWasm = f.endsWith('.wasm');
  check(
    `/mediapipe/${f} → ${res.status}${wantWasm ? ' application/wasm' : ''}`,
    res.ok && (!wantWasm || ct.includes('application/wasm')),
    `${res.status} ${ct}`
  );
}
const modelRes = await fetch(`${BASE}/models/selfie_segmenter.tflite`);
check('/models/selfie_segmenter.tflite is served', modelRes.ok, String(modelRes.status));
const served = Buffer.from(await modelRes.arrayBuffer());
// Compare BYTES, not content-length: the header is absent or different under
// compressed/chunked transfer, which says nothing about what arrived.
check('and the bytes match the file on disk', served.length === model.length && served.equals(model), `${served.length} vs ${model.length}`);

/* ── Why a missing asset here is so hard to diagnose ────────────────
   The host rewrites unmatched paths to index.html (vercel.json, and vite
   preview does the same). So a MISSING wasm file does not 404 — it returns
   200 with HTML, and MediaPipe then tries to run HTML as JavaScript or
   instantiate it as a module. The resulting error mentions neither the file
   nor the fact that it is absent, which is exactly how the missing nosimd
   variant presented as "background effects could not start".
   Pinned so nobody mistakes a 200 here for the asset existing. */
const bogus = await fetch(`${BASE}/mediapipe/definitely-not-here.wasm`);
const bogusType = bogus.headers.get('content-type') || '';
check(
  'a missing asset is masked by the SPA fallback (200 HTML, never a 404)',
  bogus.status === 200 && bogusType.includes('text/html'),
  `${bogus.status} ${bogusType}`
);
check(
  'and crucially never claims to be wasm — that would be undebuggable',
  !bogusType.includes('application/wasm'),
  bogusType
);

preview.kill();
await sleep(300);

const passed = results.filter(Boolean).length;
console.log(`\n${'─'.repeat(56)}\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
