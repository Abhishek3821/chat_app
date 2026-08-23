/**
 * A stand-in for YOUR SaaS backend — the smallest thing that can host the embed.
 *
 * It does exactly two jobs, and they are the only two your real product has to do:
 *
 *   1. serve a page that loads embed.js
 *   2. expose ONE endpoint that mints a ChatKonect user token for the logged-in
 *      user, behind your own session
 *
 * The app secret lives here and never reaches the browser. That split is the whole
 * security model: a leaked user token exposes one person for minutes, a leaked app
 * secret exposes the entire tenant until it is rotated.
 *
 * Node built-ins only — no install step, so it can be run immediately.
 *
 *   APP_ID=app_xxx APP_SECRET=cc_sk_xxx node examples/saas-host/server.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 4321;
/** Where the ChatKonect FRONTEND is served (serves /embed.js and /embed). */
const CK_HOST = (process.env.CHATKONECT_HOST || 'http://localhost:5290').replace(/\/+$/, '');
/** Where the ChatKonect API is served (mints tokens). */
const CK_API = (process.env.CHATKONECT_API || 'http://localhost:5000').replace(/\/+$/, '');

const APP_ID = process.env.APP_ID || '';
const APP_SECRET = process.env.APP_SECRET || '';

if (!APP_ID || !APP_SECRET) {
  console.error('\nMissing credentials. Create an app in the ChatKonect admin console (/platform),');
  console.error('then run:\n');
  console.error('  APP_ID=app_xxx APP_SECRET=cc_sk_xxx node examples/saas-host/server.mjs\n');
  process.exit(1);
}

/* Pretend this came out of YOUR session. In your real product these are the
   signed-in user's id and profile — that is the entire mapping you have to do. */
function currentUser(req) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const who = url.searchParams.get('as') || 'alice';
  return {
    id: `saas-user-${who}`, // becomes ChatKonect's externalId
    name: who.charAt(0).toUpperCase() + who.slice(1),
    avatar: '',
  };
}

const ck = {
  'X-CC-App-Id': APP_ID,
  Authorization: `Bearer ${APP_SECRET}`,
  'Content-Type': 'application/json',
};

async function mintToken(user) {
  // Idempotent: safe on every call, and it keeps name/avatar in sync.
  const up = await fetch(`${CK_API}/api/v1/platform/users`, {
    method: 'POST',
    headers: ck,
    body: JSON.stringify({ externalId: user.id, name: user.name, avatar: user.avatar }),
  });
  if (!up.ok && up.status !== 409) {
    throw new Error(`provision failed (${up.status}): ${(await up.text()).slice(0, 200)}`);
  }

  const res = await fetch(`${CK_API}/api/v1/platform/tokens`, {
    method: 'POST',
    headers: ck,
    body: JSON.stringify({ externalId: user.id }),
  });
  if (!res.ok) throw new Error(`mint failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/chat-token') {
    /* In your product: authenticate FIRST. Without that check this endpoint
       impersonates any user in your tenant on request. */
    try {
      const user = currentUser(req);
      const { token, expiresInSeconds, features } = await mintToken(user);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      // Note what is NOT here: the app secret.
      res.end(JSON.stringify({ token, expiresInSeconds, features }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = fs
      .readFileSync(path.join(__dirname, 'index.html'), 'utf8')
      .replace(/__CK_HOST__/g, CK_HOST)
      .replace(/__APP_ID__/g, APP_ID);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  Host app     http://localhost:${PORT}`);
  console.log(`  Second user  http://localhost:${PORT}/?as=bob   (open in another window to chat)`);
  console.log(`  Embed from   ${CK_HOST}`);
  console.log(`  API          ${CK_API}`);
  console.log(`  Tenant       ${APP_ID}\n`);
  console.log(`  If the frame stays on "Connecting…", the app's allowedOrigins must`);
  console.log(`  include  http://localhost:${PORT}  (or be empty).\n`);
});
