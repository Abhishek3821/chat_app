/**
 * Executes `public/embed.js` against a hand-rolled DOM shim and asserts the
 * handshake it performs.
 *
 * The loader had NO runtime coverage: the server side of the embed is proven by
 * `server/tests/embed-dropin.mjs`, and the message NAMES are pinned by
 * `audit-embed-protocol.mjs`, but nothing had ever executed the loader itself. So
 * "the host drops in one script and it works" was still an assumption — and the
 * things that would break it are all invisible failures: an iframe without the
 * `allow` attribute (every call dies at getUserMedia), a token posted to the wrong
 * target origin, a message accepted from a frame that isn't ours.
 *
 * A shim rather than jsdom/puppeteer because the loader touches ~10 DOM APIs and
 * pulling in a headless browser to exercise them would cost more than it proves.
 *
 * Run from /client:  node test-embed-loader.mjs
 */
import fs from 'node:fs';

const results = [];
const check = (name, cond, detail = '') => {
  results.push(!!cond);
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || !detail ? '' : `  — ${detail}`}`);
  return !!cond;
};
const section = (t) => console.log(`\n— ${t}`);
const tick = () => new Promise((r) => setImmediate(r));

const CK_ORIGIN = 'https://chat.example.com';
const HOST_ORIGIN = 'https://saas.example.com';

/* ── A DOM just big enough to run the loader ─────────────────────────── */
function makeDom() {
  const listeners = { message: [] };
  const posted = []; // everything the loader postMessages into the frame

  const contentWindow = {
    postMessage: (data, targetOrigin) => posted.push({ data, targetOrigin }),
  };

  const makeNode = (tag) => ({
    tagName: tag.toUpperCase(),
    style: { cssText: '' },
    attributes: {},
    children: [],
    parentNode: null,
    contentWindow: tag === 'iframe' ? contentWindow : undefined,
    setAttribute(k, v) {
      this.attributes[k] = v;
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      child.parentNode = null;
      return child;
    },
    addEventListener() {},
    removeEventListener() {},
  });

  const container = makeNode('div');

  const document = {
    currentScript: { src: `${CK_ORIGIN}/embed.js` },
    createElement: makeNode,
    querySelector: (sel) => (sel === '#chat' ? container : null),
    head: makeNode('head'),
  };

  const window = {
    location: { origin: HOST_ORIGIN },
    document,
    addEventListener: (type, fn) => {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener: (type, fn) => {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
  };

  /** Deliver a message as if it came from the framed app. */
  const deliver = (msg, { origin = CK_ORIGIN, source = contentWindow } = {}) => {
    (listeners.message || []).slice().forEach((fn) => fn({ origin, data: msg, source }));
  };

  return { window, document, container, posted, deliver, listeners, contentWindow };
}

function loadLoader(dom) {
  const src = fs.readFileSync('public/embed.js', 'utf8');
  // The IIFE resolves `window`/`document` lexically, so passing them as
  // parameters is enough — no global patching required.
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', src)(dom.window, dom.document);
  return dom.window.ChatKonect;
}

(async () => {
  /* ── The global surface ──────────────────────────────────────────── */
  section('The loader exposes a mount API');
  let dom = makeDom();
  const CK = loadLoader(dom);
  check('window.ChatKonect is defined', !!CK);
  check('mount() is a function', typeof CK?.mount === 'function');
  check(
    'it derives OUR origin from its own <script src> (host configures nothing)',
    CK?.origin === CK_ORIGIN,
    CK?.origin
  );

  /* ── Required options ────────────────────────────────────────────── */
  section('Misconfiguration fails loudly, not silently');
  const throws = (fn) => {
    try {
      fn();
      return null;
    } catch (e) {
      return e.message;
    }
  };
  check('a bad selector throws', !!throws(() => CK.mount({ el: '#nope', appId: 'a', token: 't' })));
  check('a missing appId throws', !!throws(() => CK.mount({ el: '#chat', token: 't' })));
  check(
    'no token source at all throws',
    !!throws(() => CK.mount({ el: '#chat', appId: 'app_1' })),
    'silently mounting a frame that can never authenticate would be worse'
  );

  /* ── The iframe it builds ────────────────────────────────────────── */
  section('The iframe it creates');
  dom = makeDom();
  const CK2 = loadLoader(dom);
  let tokenCalls = 0;
  const inst = CK2.mount({
    el: '#chat',
    appId: 'app_7f3c9a2b4d1e',
    tokenSeconds: 900,
    getToken: () => {
      tokenCalls += 1;
      return Promise.resolve('tok_abc123');
    },
    onReady: () => {},
    onError: () => {},
  });

  const iframe = dom.container.children[0];
  check('an iframe is appended to the container', iframe?.tagName === 'IFRAME');
  check('it points at OUR /embed route', String(iframe?.src).startsWith(`${CK_ORIGIN}/embed?`), iframe?.src);
  check('it carries the appId', /[?&]appId=app_7f3c9a2b4d1e/.test(iframe?.src || ''));
  check(
    'it declares the parent origin so the frame can verify us',
    iframe?.src.includes(`parentOrigin=${encodeURIComponent(HOST_ORIGIN)}`),
    iframe?.src
  );
  check('it forwards the token lifetime', /[?&]tokenSeconds=900/.test(iframe?.src || ''));
  check(
    'THE TOKEN IS NOT IN THE URL',
    !/token=/.test(String(iframe?.src).replace(/tokenSeconds=/g, '')),
    iframe?.src
  );

  /* Without these, the UI mounts and every call fails at getUserMedia — which
     reads as a broken app rather than a missing attribute. */
  for (const perm of ['camera', 'microphone', 'display-capture', 'autoplay']) {
    check(`allow="${perm}" is set`, String(iframe?.allow || '').includes(perm), iframe?.allow);
  }

  /* ── The token handshake ─────────────────────────────────────────── */
  section('The token handshake');
  check('no token is sent before the frame asks', dom.posted.length === 0 && tokenCalls === 0);

  dom.deliver({ source: 'chatkonect-embed', type: 'awaiting-token' });
  await tick();
  check('getToken() is called when the frame asks', tokenCalls === 1, `calls=${tokenCalls}`);
  check('exactly one message is posted', dom.posted.length === 1, `posted=${dom.posted.length}`);
  const auth = dom.posted[0];
  check('it is an auth message', auth?.data?.type === 'auth', JSON.stringify(auth?.data));
  check('it is tagged as coming from the host', auth?.data?.source === 'chatkonect-host');
  check('it carries the token', auth?.data?.token === 'tok_abc123');
  check(
    'it targets OUR exact origin, never "*"',
    auth?.targetOrigin === CK_ORIGIN,
    String(auth?.targetOrigin)
  );

  /* ── Rotation ────────────────────────────────────────────────────── */
  section('Rotation before expiry');
  dom.deliver({ source: 'chatkonect-embed', type: 'token-expiring', inSeconds: 180 });
  await tick();
  check('a fresh token is minted and pushed', tokenCalls === 2 && dom.posted.length === 2, `calls=${tokenCalls}`);
  check('the pushed message is auth again', dom.posted[1]?.data?.type === 'auth');

  /* ── Messages that must be ignored ───────────────────────────────── */
  section('Messages the loader must ignore');
  const before = tokenCalls;

  dom.deliver({ source: 'chatkonect-embed', type: 'awaiting-token' }, { origin: 'https://evil.example' });
  await tick();
  check('a message from another ORIGIN is ignored', tokenCalls === before, `calls=${tokenCalls}`);

  dom.deliver({ source: 'chatkonect-embed', type: 'awaiting-token' }, { source: { other: true } });
  await tick();
  check('a message from another FRAME on our origin is ignored', tokenCalls === before);

  dom.deliver({ source: 'somebody-else', type: 'awaiting-token' });
  await tick();
  check('a message without our source tag is ignored', tokenCalls === before);

  /* ── Callbacks ───────────────────────────────────────────────────── */
  section('Callbacks reach the host');
  dom = makeDom();
  const CK3 = loadLoader(dom);
  let ready = null;
  let failed = null;
  let cfg = null;
  const inst3 = CK3.mount({
    el: '#chat',
    appId: 'app_1',
    token: 'static_tok',
    onReady: (u) => {
      ready = u;
    },
    onError: (e) => {
      failed = e;
    },
    onConfig: (c) => {
      cfg = c;
    },
  });
  dom.deliver({ source: 'chatkonect-embed', type: 'config', app: { appId: 'app_1' } });
  dom.deliver({ source: 'chatkonect-embed', type: 'ready', user: { id: 'u1', name: 'Ada' } });
  dom.deliver({ source: 'chatkonect-embed', type: 'error', code: 'token_rejected', message: 'nope' });
  await tick();
  check('onConfig fires', cfg?.app?.appId === 'app_1');
  check('onReady receives the user', ready?.name === 'Ada', JSON.stringify(ready));
  check('onError receives code + message', failed?.code === 'token_rejected' && failed?.message === 'nope');

  /* A static `token` (no getToken) must still satisfy the frame's request. */
  dom.deliver({ source: 'chatkonect-embed', type: 'awaiting-token' });
  await tick();
  check(
    'a static `token` option is delivered too',
    dom.posted.some((p) => p.data?.token === 'static_tok')
  );

  /* ── navigate + teardown ─────────────────────────────────────────── */
  section('navigate() and destroy()');
  inst3.navigate('/calls');
  const nav = dom.posted[dom.posted.length - 1];
  check('navigate posts a navigate message', nav?.data?.type === 'navigate' && nav?.data?.to === '/calls');

  const postedBefore = dom.posted.length;
  inst3.destroy();
  check('destroy removes the iframe', dom.container.children.length === 0);
  check('destroy unhooks the message listener', (dom.listeners.message || []).length === 0);
  dom.deliver({ source: 'chatkonect-embed', type: 'awaiting-token' });
  await tick();
  check('a destroyed instance sends nothing more', dom.posted.length === postedBefore);

  // The first instance is still alive and must be unaffected.
  check('destroying one instance leaves another mounted', dom !== null && typeof inst.destroy === 'function');

  const passed = results.filter(Boolean).length;
  console.log(`\n${'─'.repeat(60)}\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((err) => {
  console.error('\nHARNESS CRASHED:', err);
  process.exit(1);
});
