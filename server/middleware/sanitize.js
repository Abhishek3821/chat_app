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

export function mongoSanitize(req, _res, next) {
  scrub(req.body);
  scrub(req.query);
  scrub(req.params);
  next();
}
