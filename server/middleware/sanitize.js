/**
 * NoSQL operator-injection guard (defense-in-depth for A03).
 *
 * Recursively strips keys that begin with `$` or contain `.` from the request
 * body, query and params, so a payload like `{ "email": { "$gt": "" } }` can't
 * smuggle query operators into Mongoose. Mongoose schema-casting already blocks
 * most of this, but stripping at the edge covers Mixed/Object fields too.
 */
function scrub(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return;
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || key.includes('.')) {
      delete obj[key];
      continue;
    }
    const val = obj[key];
    if (val && typeof val === 'object') scrub(val, depth + 1);
  }
}

/**
 * Collapse duplicated query parameters (HTTP parameter pollution).
 *
 * `?limit=10&limit=99` makes Express hand you `['10','99']`. Validation written
 * for a string then behaves unpredictably — `Number(['10','99'])` is NaN, an
 * `includes()` allow-list check fails open or closed depending on the caller,
 * and a value that reaches a query as an array changes its meaning entirely.
 *
 * Every query parameter this API reads is a single scalar (before, limit, pass,
 * q, radius, scope, token — verified, none accept a list), so keeping the LAST
 * occurrence is always the right collapse and matches `hpp`'s default. Done here
 * instead of adding that dependency for ten lines.
 *
 * `req.body` is deliberately untouched: JSON bodies have real arrays in them.
 */
function collapseDuplicates(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (Array.isArray(val)) obj[key] = val[val.length - 1];
  }
}

export function mongoSanitize(req, _res, next) {
  scrub(req.body);
  scrub(req.query);
  scrub(req.params);
  collapseDuplicates(req.query);
  collapseDuplicates(req.params);
  next();
}
