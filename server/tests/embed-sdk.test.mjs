import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { loadChatKonect } from '../../packages/react/src/loader.js';
import { createChatKonectClient } from '../../packages/node/src/index.js';
import { tokenRefreshDelay, bindEmbedRefresh, requestEmbedRefresh, completeEmbedRefresh } from '../../client/src/lib/embedSession.js';

const loaderSource = fs.readFileSync(new URL('../../client/public/embed.js', import.meta.url), 'utf8');
function hostHarness(getToken = () => 'user-token') {
  const sent = [], listeners = new Set(), errors = [], ready = [];
  const frame = { style: {}, contentWindow: { postMessage: (message, origin) => sent.push({ message, origin }) }, setAttribute() {} };
  const container = { appendChild(f) { f.parentNode = this; }, removeChild(f) { f.parentNode = null; } };
  const window = { location: { origin: 'https://partner.example' }, addEventListener: (_, cb) => listeners.add(cb), removeEventListener: (_, cb) => listeners.delete(cb) };
  const document = { currentScript: { src: 'https://chat.example/embed.js' }, querySelector: () => container, createElement: () => frame };
  vm.runInNewContext(loaderSource, { window, document, URL, URLSearchParams, Promise });
  const instance = window.ChatKonect.mount({ el: container, appId: 'app_test', getToken, onError: (e) => errors.push(e), onReady: (u) => ready.push(u) });
  const emit = (type, extra = {}, source = frame.contentWindow, origin = 'https://chat.example') => {
    for (const cb of listeners) cb({ origin, source, data: { source: 'chatkonect-embed', type, ...extra } });
  };
  return { window, frame, sent, errors, ready, listeners, instance, emit };
}
const flush = () => new Promise((r) => setImmediate(r));

test('embed grants device permissions and never puts a token in the URL', () => {
  const h = hostHarness();
  assert.match(h.frame.allow, /camera/); assert.match(h.frame.allow, /microphone/); assert.match(h.frame.allow, /display-capture/);
  assert.match(h.frame.src, /parentOrigin=/); assert.doesNotMatch(h.frame.src, /user-token/);
});
test('only messages from the created frame on its exact origin request a token', async () => {
  let calls = 0;
  const h = hostHarness(() => { calls++; return 'jwt'; });
  h.emit('awaiting-token', {}, {}, 'https://chat.example');
  h.emit('awaiting-token', {}, h.frame.contentWindow, 'https://chat.example.evil');
  await flush(); assert.equal(calls, 0);
  h.emit('awaiting-token'); await flush(); assert.equal(calls, 1);
  assert.equal(h.sent[0].origin, 'https://chat.example');
});
test('full token JSON is accepted and concurrent renewal requests share one call', async () => {
  let resolve, calls = 0;
  const h = hostHarness(() => { calls++; return new Promise((r) => { resolve = r; }); });
  h.emit('awaiting-token'); h.emit('token-expiring');
  assert.equal(calls, 1);
  resolve({ token: 'fresh-jwt', expiresInSeconds: 300 }); await flush();
  assert.equal(h.sent[0].message.token, 'fresh-jwt');
});
test('navigation issued before authentication is delivered after ready', () => {
  const h = hostHarness(); h.instance.navigate('/meet/ABC-123');
  assert.equal(h.sent.length, 0);
  h.emit('ready', { user: { id: 'alice' } });
  assert.equal(h.sent[0].message.to, '/meet/ABC-123');
});
test('destroy removes the listener and ignores a token that resolves late', async () => {
  let resolve;
  const h = hostHarness(() => new Promise((r) => { resolve = r; }));
  h.emit('awaiting-token'); h.instance.destroy(); resolve('late-token'); await flush();
  assert.equal(h.sent.length, 0); assert.equal(h.listeners.size, 0); assert.equal(h.frame.parentNode, null);
});
test('failed and malformed token providers report an error without sending credentials', async () => {
  for (const getToken of [() => { throw new Error('failed'); }, () => Promise.reject(new Error('failed')), () => ({})]) {
    const h = hostHarness(getToken); h.emit('awaiting-token'); await flush();
    assert.equal(h.errors.length, 1);
    assert.equal(h.sent[0].message.type, 'auth-error');
    assert.equal(h.sent.some((x) => x.message.type === 'auth'), false);
  }
});
test('five-minute and already-aged JWTs renew before expiry', () => {
  const now = 1800000000000;
  const token = (seconds) => `header.${Buffer.from(JSON.stringify({ exp: now / 1000 + seconds })).toString('base64url')}.signature`;
  assert.equal(tokenRefreshDelay(token(300), 3600, now), 240000);
  assert.equal(tokenRefreshDelay(token(40), 3600, now), 10000);
  assert.equal(tokenRefreshDelay(token(-1), 3600, now), 1000);
});
test('API and socket renewal wait on one host response and resolve together', async () => {
  let calls = 0;
  const cleanup = bindEmbedRefresh(() => { calls++; });
  const a = requestEmbedRefresh(), b = requestEmbedRefresh();
  assert.equal(a, b); assert.equal(calls, 1);
  completeEmbedRefresh('new-jwt'); assert.equal(await a, 'new-jwt'); cleanup();
  assert.equal(await requestEmbedRefresh(), null);
});
test('renewal cleanup resolves pending requests', async () => {
  const cleanup = bindEmbedRefresh(() => {}), pending = requestEmbedRefresh();
  cleanup(); assert.equal(await pending, null);
});
test('embedded token storage neither reads nor overwrites an ordinary login', () => {
  let touches = 0;
  const source = fs.readFileSync(new URL('../../client/src/lib/token.js', import.meta.url), 'utf8')
    .replace("import { IS_EMBED } from './embedSession';", 'const IS_EMBED = true;').replace(/export function /g, 'function ');
  const sandbox = { localStorage: { getItem() { touches++; return 'operator'; }, setItem() { touches++; }, removeItem() { touches++; } } };
  vm.runInNewContext(source + '\nglobalThis.tokens = { getToken, setToken, clearToken };', sandbox);
  assert.equal(sandbox.tokens.getToken(), null);
  sandbox.tokens.setToken('tenant'); assert.equal(sandbox.tokens.getToken(), 'tenant');
  sandbox.tokens.clearToken(); assert.equal(sandbox.tokens.getToken(), null); assert.equal(touches, 0);
});
test('backend helper normalizes API URLs, stringifies ids and returns only a user session', async () => {
  for (const apiUrl of ['https://api.example', 'https://api.example/api/']) {
    const calls = [];
    const client = createChatKonectClient({ apiUrl, appId: 'app_test', appSecret: 'secret-server-only', fetch: async (url, opts) => {
      calls.push({ url, opts });
      return Response.json(url.endsWith('/tokens') ? { token: 'user-jwt', expiresInSeconds: 300 } : { created: true });
    } });
    const session = await client.createUserSession({ id: 42, name: 'Ada' });
    assert.equal(calls[0].url, 'https://api.example/api/v1/platform/users');
    assert.equal(JSON.parse(calls[0].opts.body).externalId, '42');
    assert.equal(calls[1].url, 'https://api.example/api/v1/platform/tokens');
    assert.equal(session.token, 'user-jwt'); assert.doesNotMatch(JSON.stringify(session), /secret-server-only/);
  }
});
test('backend provisioning failure stops minting and errors do not expose secrets', async () => {
  let calls = 0;
  const client = createChatKonectClient({ apiUrl: 'https://api.example', appId: 'app_test', appSecret: 'sensitive', fetch: async () => { calls++; return new Response('sensitive', { status: 403 }); } });
  await assert.rejects(client.createUserSession({ id: 'alice', name: 'Alice' }), /HTTP 403/);
  assert.equal(calls, 1);
  await assert.rejects(client.createUserSession({ id: '', name: 'Alice' }), /stable user id/);
});
test('React package imports without a JSX transpiler', async () => {
  // Resolve the peer from a consuming React app, as an installed tarball does.
  const require = createRequire(new URL('../../client/package.json', import.meta.url));
  const source = fs.readFileSync(new URL('../../packages/react/src/index.js', import.meta.url), 'utf8')
    .replace("from 'react'", `from '${pathToFileURL(require.resolve('react')).href}'`)
    .replace("from './loader.js'", `from '${new URL('../../packages/react/src/loader.js', import.meta.url).href}'`);
  const { ChatKonect } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  assert.equal(typeof ChatKonect.render, 'function');
});
test('deployment anti-framing headers exclude every embed route', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../../client/vercel.json', import.meta.url)));
  const denyRule = config.headers.find((r) => r.headers.some((h) => h.key === 'X-Frame-Options'));
  const matcher = new RegExp(`^${denyRule.source}$`);
  for (const path of ['/embed', '/embed/', '/embed/meet/ABC', '/embed/settings']) assert.equal(matcher.test(path), false, path);
  for (const path of ['/', '/login', '/platform', '/embedded-other']) assert.equal(matcher.test(path), true, path);
});

test('React loader shares a request while keeping different frontend origins separate', async () => {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  const scripts = [];
  globalThis.window = { ChatKonectLoaders: {} };
  globalThis.document = { createElement: () => ({ remove() {} }), head: { appendChild: (script) => scripts.push(script) } };
  try {
    const a = loadChatKonect('https://loader-a.example'), again = loadChatKonect('https://loader-a.example/');
    const b = loadChatKonect('https://loader-b.example');
    assert.equal(scripts.length, 2);
    const loaderA = { origin: 'https://loader-a.example' }, loaderB = { origin: 'https://loader-b.example' };
    window.ChatKonectLoaders[loaderA.origin] = loaderA;
    window.ChatKonectLoaders[loaderB.origin] = loaderB;
    window.ChatKonect = loaderB;
    scripts[0].onload(); scripts[1].onload();
    assert.equal(await a, loaderA); assert.equal(await again, loaderA); assert.equal(await b, loaderB);
    await assert.rejects(loadChatKonect('not-an-origin'));
  } finally { globalThis.window = previousWindow; globalThis.document = previousDocument; }
});

test('React loader failure can be retried after CSP or network configuration is fixed', async () => {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  const scripts = [];
  globalThis.window = { ChatKonectLoaders: {} };
  globalThis.document = { createElement: () => ({ remove() {} }), head: { appendChild: (script) => scripts.push(script) } };
  try {
    const failed = loadChatKonect('https://retry-loader.example');
    scripts[0].onerror(); await assert.rejects(failed, /Could not load/);
    const retry = loadChatKonect('https://retry-loader.example');
    assert.equal(scripts.length, 2);
    const loader = { origin: 'https://retry-loader.example' };
    window.ChatKonectLoaders[loader.origin] = loader;
    scripts[1].onload(); assert.equal(await retry, loader);
  } finally { globalThis.window = previousWindow; globalThis.document = previousDocument; }
});
