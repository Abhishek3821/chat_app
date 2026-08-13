/**
 * Generate docs/API.md from the SOURCE.
 *
 * Hand-written endpoint tables drift the moment a route is added — the previous
 * API.md claimed 158 endpoints when the code had 181, and then went missing
 * entirely. This derives every entry from routes/ + controllers/ so the reference
 * cannot disagree with the code: re-run it after any route change.
 *
 * What it extracts per endpoint:
 *   · method + full path (router mount prefix + route path)
 *   · auth requirement (router-level `protect`, admin, feature flag, app secret)
 *   · per-route middleware (rate limiters, upload handlers)
 *   · the handler's own leading comment as the description — this codebase
 *     documents its controllers well, so that is the best description available
 *     and it stays in step with the code by definition
 *   · body fields, read off the handler's `req.body` destructuring
 *
 * Run:  node tests/gen-api-docs.mjs   (from /server)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const ROUTES_DIR = path.join(SERVER_DIR, 'routes');
const CONTROLLERS_DIR = path.join(SERVER_DIR, 'controllers');
const OUT = path.resolve(SERVER_DIR, '..', 'docs', 'API.md');

/* ── 1. Mount prefixes from routes/index.js ────────────────────────── */
const indexSrc = fs.readFileSync(path.join(ROUTES_DIR, 'index.js'), 'utf8');
const mounts = new Map(); // identifier -> { file, prefix, comment }

for (const m of indexSrc.matchAll(/import\s+(\w+)\s+from\s+'\.\/([\w.]+\.js)'/g)) mounts.set(m[1], { file: m[2] });
for (const m of indexSrc.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([\w.]+\.js)'/g)) {
  for (const nm of m[1].split(',')) {
    const id = nm.trim().split(/\s+as\s+/).pop().trim();
    if (id) mounts.set(id, { file: m[2] });
  }
}
for (const m of indexSrc.matchAll(/router\.use\(\s*'([^']+)'\s*,\s*(\w+)\s*\);?\s*(?:\/\/\s*(.*))?/g)) {
  const e = mounts.get(m[2]);
  if (e) {
    e.prefix = m[1];
    e.comment = (m[3] || '').trim();
  }
}

/* ── 2. Controller sources, indexed by exported handler name ───────── */
const handlers = new Map(); // name -> { doc, bodyFields, file }
const stripStars = (block) =>
  block
    .split('\n')
    .map((l) => l.replace(/^\s*\/?\*+\/?/, '').replace(/^\s*\/\/\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

for (const f of fs.readdirSync(CONTROLLERS_DIR).filter((n) => n.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(CONTROLLERS_DIR, f), 'utf8');
  /* `\n?` between the comment block and the export tolerates a blank line, which
     several controllers have — without it those handlers came out undescribed. */
  for (const m of src.matchAll(/(?:^|\n)((?:[ \t]*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)\n)+)\n?[ \t]*export const (\w+)\s*=\s*asyncHandler/g)) {
    const [, commentBlock, name] = m;
    const raw = stripStars(commentBlock || '');
    /* Drop a leading "METHOD /path —" restatement, since the table already shows
       both. But KEEP it if that is all the comment says: stripping it left ~70
       endpoints with an empty description, which is worse than a redundant one. */
    const stripped = raw.replace(/^(GET|POST|PUT|PATCH|DELETE)\s+\/\S*\s*(\{[^}]*\})?\s*[—–-]?\s*/i, '').trim();
    const doc = stripped || raw;
    const firstSentence = doc.split(/(?<=[.!?])\s/)[0] || '';

    /* Body fields, from the handler's own destructuring — scanned only to the END
       of THIS handler. A fixed-size window overran into the next function and
       attributed its fields to this endpoint (it had `GET /auth/me` taking an
       `email` body), which is worse than listing nothing: a reader would build
       against a contract that does not exist. */
    const bodyStart = m.index + m[0].length;
    const nextExport = src.indexOf('\nexport const', bodyStart);
    const after = src.slice(bodyStart, nextExport === -1 ? src.length : nextExport);
    const destructure = after.match(/const\s*\{([^}]+)\}\s*=\s*req\.body/);
    const bodyFields = destructure
      ? destructure[1]
          .split(',')
          .map((s) => s.split('=')[0].trim().replace(/^\.\.\./, ''))
          .filter((s) => /^[A-Za-z_]\w*$/.test(s))
      : [];
    // Also catch single reads: req.body.foo
    const singles = [...after.matchAll(/req\.body\.(\w+)/g)].map((x) => x[1]);
    handlers.set(name, {
      doc: firstSentence.slice(0, 240),
      bodyFields: [...new Set([...bodyFields, ...singles])],
      file: f,
    });
  }
}

/* ── 3. Routes per router file ─────────────────────────────────────── */
/** `getMeetingReport` → "Get meeting report". */
const humanize = (name) => {
  const words = String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const AUTH_LABEL = {
  protect: 'Session',
  appSecretAuth: 'App secret',
  apiKeyAuth: 'API key',
};

const groups = [];
for (const [, entry] of mounts) {
  if (!entry.prefix || !entry.file) continue;
  const file = path.join(ROUTES_DIR, entry.file);
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, 'utf8');

  /* Router-level middleware applies to every route in the file.
     Parses ALL comma-separated arguments: `router.use(protect, adminOnly)` is how
     the admin and key routers are guarded, and a single-argument pattern matched
     neither — so those routers were documented as PUBLIC. Handing a developer a
     doc that calls the admin API public is the worst kind of wrong. */
  const routerLevel = [];
  for (const m of src.matchAll(/\w+\.use\(([^)]*(?:\([^)]*\))?[^)]*)\)/g)) {
    for (const arg of m[1].split(',')) {
      const a = arg.trim();
      const feat = a.match(/^requireFeature\('([^']+)'\)/);
      if (feat) routerLevel.push(`Feature: \`${feat[1]}\``);
      else if (AUTH_LABEL[a]) routerLevel.push(AUTH_LABEL[a]);
      else if (/^adminOnly$/.test(a)) routerLevel.push('**Admin**');
    }
  }

  const rows = [];
  const pushRow = (method, sub, handlerChain) => {
    /* Split on top-level commas only — a naive split(',') would cut
       `apiKeyAuth(['a','b'])` into fragments. */
    const names = [];
    let buf = '';
    let depth = 0;
    for (const ch of handlerChain) {
      if (ch === '(' || ch === '[') depth += 1;
      else if (ch === ')' || ch === ']') depth -= 1;
      if (ch === ',' && depth === 0) {
        names.push(buf.trim());
        buf = '';
      } else buf += ch;
    }
    if (buf.trim()) names.push(buf.trim());

    /* The handler is the last BARE identifier. Taking simply the last element got
       it wrong wherever the chain ends in a CALL — an inline arrow handler, or a
       trailing middleware — and a wrong name means no description. */
    const bare = names.filter((n) => /^[A-Za-z_]\w*$/.test(n));
    const handlerName = bare[bare.length - 1] || '';
    const middleware = names.filter((n) => n !== handlerName);
    const info = handlers.get(handlerName) || {};
    rows.push({
      method: method.toUpperCase(),
      path: (entry.prefix.replace(/\/$/, '') + (sub === '/' ? '' : sub)) || '/',
      handler: handlerName,
      middleware,
      /* Last resort: read the handler NAME as prose (`getMeetingReport` → "Get
         meeting report"). Derived, never invented — and far more useful to a
         reader than an em dash. Marked so nobody mistakes it for authored copy. */
      /* No named controller at all (an inline arrow handler defined in the route
         file) — say so rather than emitting an empty cell. */
      doc: info.doc || (handlerName ? `${humanize(handlerName)} _(from handler name)_` : '_handled inline in the route file_'),
      bodyFields: info.bodyFields || [],
      /* PER-ROUTE auth. /auth and /v1 apply it route by route rather than with a
         router-wide `use`, so a single header line cannot describe them: /auth
         mixes public (login, signup) with session-only (sessions,
         change-password), and every /v1 route carries its own API-key SCOPES. */
      rowAuth: (() => {
        const labels = [];
        for (const mw of middleware) {
          if (mw === 'protect') labels.push('Session');
          else if (mw === 'adminOnly') labels.push('**Admin**');
        }
        const scoped = handlerChain.match(/apiKeyAuth\(\s*\[([^\]]*)\]\s*\)/);
        if (scoped) {
          const scopes = [...scoped[1].matchAll(/'([^']+)'/g)].map((x) => `\`${x[1]}\``);
          labels.push(scopes.length ? `API key: ${scopes.join(', ')}` : 'API key');
        } else if (/apiKeyAuth\(\s*\)/.test(handlerChain)) labels.push('API key');
        return [...new Set(labels)];
      })(),
    });
  };

  /**
   * Read each route call's arguments with BALANCED parentheses.
   *
   * A `[^)]*` capture stops at the first `)`, which for
   * `router.get('/contacts', apiKeyAuth(['contacts:read']), getContacts)` is the
   * one closing `apiKeyAuth(...)`. That truncated the middleware chain, so the
   * scope was lost AND the last token was mistaken for the handler — corrupting
   * the auth and the description of every /v1 endpoint at once.
   */
  for (const m of src.matchAll(/\b\w+\s*\.\s*(get|post|put|patch|delete)\s*\(\s*'([^']*)'\s*,?/g)) {
    let i = m.index + m[0].length;
    let depth = 1; // we are inside the route call's own parens
    let chain = '';
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '(') depth += 1;
      else if (c === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
      chain += c;
      i += 1;
    }
    pushRow(m[1], m[2], chain);
  }
  for (const m of src.matchAll(/\b\w+\s*\.\s*route\s*\(\s*'([^']*)'\s*\)((?:\s*\.\s*\w+\([^)]*\))+)/g)) {
    for (const v of m[2].matchAll(/\.\s*(get|post|put|patch|delete)\s*\(([^)]*)\)/g)) {
      pushRow(v[1], m[1], v[2] || '');
    }
  }

  if (rows.length) {
    groups.push({
      prefix: entry.prefix,
      file: entry.file,
      comment: entry.comment,
      auth: [...new Set(routerLevel)],
      rows,
    });
  }
}

groups.sort((a, b) => a.prefix.localeCompare(b.prefix));
const total = groups.reduce((n, g) => n + g.rows.length, 0);

/* ── 4. Emit ───────────────────────────────────────────────────────── */
const esc = (s) => String(s).replace(/\|/g, '\\|');
const anchor = (p) => p.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

let out = `# ChatKonect — Backend API Reference

> **Generated from source** by \`server/tests/gen-api-docs.mjs\`. Re-run it after any
> route change; do not hand-edit the endpoint tables below. Every path, method,
> auth requirement and body field here was read out of \`server/routes/\` and
> \`server/controllers/\`, so this cannot silently disagree with the code.
>
> **${total} endpoints across ${groups.length} routers.**

---

## 1. Base URL

| Environment | Base URL |
|---|---|
| Production | \`https://<your-backend-host>/api\` |
| Local | \`http://localhost:5000/api\` |

Every path in this document is relative to that base — so \`POST /auth/login\`
means \`POST https://<host>/api/auth/login\`.

A health probe is available un-authenticated at \`GET /api/health\`. Free-tier
hosts sleep idle instances, so the first request after idle can take ~50 s; ping
\`/health\` on app start to warm it up.

## 2. Authentication

Three separate credential types. Most of the API uses the first.

| Type | Header | Used by |
|---|---|---|
| **Session** (access token) | \`Authorization: Bearer <accessToken>\` | Normal app requests |
| **API key** | \`X-API-Key: <key>\` | Server-to-server \`/v1\` integrations |
| **App secret** | \`X-CC-App-Id\` + \`Authorization: Bearer <appSecret>\` | Embedded-platform provisioning ([PLATFORM.md](PLATFORM.md)) |

### Getting a session

\`\`\`http
POST /api/auth/login
Content-Type: application/json

{ "identifier": "ada@example.com", "password": "…" }
\`\`\`

\`identifier\` accepts an **email, username or phone**. The response carries
\`accessToken\` (short-lived, send it as the Bearer token) and sets a refresh
cookie. When a request returns **401**, call \`POST /api/auth/refresh\` once and
retry; if that also fails, the session is gone and the user must sign in again.

Signup is a three-step flow, because the email is verified *before* the account
exists:

1. \`POST /auth/email/send-code\` → emails a 6-digit code
2. \`POST /auth/email/verify-code\` → returns an \`emailToken\` proof
3. \`POST /auth/signup\` with that \`emailToken\` → creates the account and returns a session

> **Mobile note:** the web client keeps the access token in \`localStorage\`. On a
> native app use the platform secure store (Keychain / Keystore), and send the
> same \`Authorization: Bearer\` header.

## 3. Response and error shape

Success responses always include \`success: true\` plus the payload:

\`\`\`json
{ "success": true, "user": { "…": "…" } }
\`\`\`

Errors are uniform — parse \`message\` and show it; the strings are written for
end users:

\`\`\`json
{ "success": false, "message": "Send a contact request and get accepted before you can chat." }
\`\`\`

| Status | Meaning |
|---|---|
| \`400\` | Validation — the message names the offending field |
| \`401\` | No/expired session → refresh once, then re-authenticate |
| \`403\` | Authenticated but not permitted (not a member, not the host, feature off) |
| \`404\` | Not found, or not visible to you |
| \`409\` | Conflict (duplicate, or an action invalid in the current state) |
| \`413\` | Upload too large (50 MB per file) |
| \`429\` | Rate limited — back off and retry |

## 4. Conventions

**Pagination** is cursor-based on the message endpoints: pass
\`?before=<ISO timestamp>&limit=40\`. A page shorter than \`limit\` means you have
reached the start of the conversation. Do not page with offsets.

**IDs** are Mongo ObjectId strings (24 hex chars).

**Realtime.** Most state changes also emit a Socket.IO event, and a well-behaved
client listens rather than polling. Connect to the same origin with
\`auth: { token: accessToken }\`. The full event list is in
[SOCKET_EVENTS.md](SOCKET_EVENTS.md) — read it alongside this file, because
several features (presence, typing, receipts, calls) are realtime-only.

**Feature flags.** Routers marked *Feature* below are disabled per tenant on the
embedded platform and return \`403\` when the tenant lacks the flag. First-party
accounts are never feature-gated.

---

## 5. Endpoints

`;

// Index table
out += '| Router | Base path | Endpoints | Auth |\n|---|---|---|---|\n';
for (const g of groups) {
  out += `| [${g.file.replace('.js', '')}](#${anchor(g.prefix)}) | \`${g.prefix}\` | ${g.rows.length} | ${g.auth.length ? g.auth.join(', ') : '—'} |\n`;
}
out += '\n---\n\n';

for (const g of groups) {
  out += `### \`${g.prefix}\`\n\n`;
  if (g.comment) out += `${g.comment}\n\n`;
  /* Don't claim a whole router is public when its auth is applied per route —
     /auth mixes public sign-in with session-only session management, and every
     /v1 route carries its own API-key scopes. */
  const varies = g.rows.some((r) => r.rowAuth.length);
  const authLine = g.auth.length
    ? g.auth.join(' + ')
    : varies
      ? 'varies per route — see the **Auth** column'
      : 'none (public)';
  out += `**Auth:** ${authLine} · **Source:** \`server/routes/${g.file}\`\n\n`;
  /* Show an Auth column only where it VARIES per route (/auth, /v1). Repeating an
     identical value on every row of the other 25 routers would be pure noise. */
  const perRouteAuth = g.rows.some((r) => r.rowAuth.length);
  out += perRouteAuth
    ? '| Method | Path | Auth | Body / notes | Description |\n|---|---|---|---|---|\n'
    : '| Method | Path | Body / notes | Description |\n|---|---|---|---|\n';
  for (const r of g.rows) {
    const extras = [];
    // GET/DELETE carry no body in this API, so listing fields for them would be
    // noise at best and a false contract at worst.
    const takesBody = ['POST', 'PUT', 'PATCH'].includes(r.method);
    if (takesBody && r.bodyFields.length) extras.push(r.bodyFields.map((b) => `\`${b}\``).join(', '));
    for (const mw of r.middleware) {
      if (/limiter/i.test(mw)) extras.push('_rate limited_');
      else if (/upload/i.test(mw)) extras.push('_multipart_');
      else if (/admin/i.test(mw)) extras.push('_admin only_');
    }
    const cells = [`\`${r.method}\``, `\`${r.path}\``];
    if (perRouteAuth) cells.push(r.rowAuth.join(' + ') || 'public');
    cells.push(esc(extras.join(' · ') || '—'), esc(r.doc || '—'));
    out += `| ${cells.join(' | ')} |\n`;
  }
  out += '\n';
}

out += `---

## 6. Where to look next

| Topic | Document |
|---|---|
| Every realtime event, both directions, plus call-signalling order | [SOCKET_EVENTS.md](SOCKET_EVENTS.md) |
| Token lifetimes, refresh rotation, sessions, two-step PIN | [AUTHENTICATION.md](AUTHENTICATION.md) |
| Upload limits, accepted types, how protected media is fetched | [FILE_UPLOADS.md](FILE_UPLOADS.md) |
| Schemas and relationships behind these payloads | [DATABASE_MODELS.md](DATABASE_MODELS.md) |
| Feature rules and the "why" behind the constraints | [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md) |
| Embedding ChatKonect in another product (tenants, user tokens) | [PLATFORM.md](PLATFORM.md) |
| Which env vars the backend reads | [ENVIRONMENT.md](ENVIRONMENT.md) |

A Postman collection is in [\`../postman/\`](../postman/) — import both the
collection and the environment, run **Auth → login**, and the token is captured
for every later request automatically.
`;

fs.writeFileSync(OUT, out);
console.log(`wrote ${path.relative(path.resolve(SERVER_DIR, '..'), OUT)}`);
console.log(`  ${total} endpoints across ${groups.length} routers`);
const undocumented = groups.flatMap((g) => g.rows.filter((r) => !r.doc)).length;
console.log(`  ${undocumented} endpoint(s) without a handler comment to describe them`);
