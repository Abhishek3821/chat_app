/**
 * Cross-tenant isolation for the embeddable platform.
 *
 * Every end user provisioned through /v1/platform belongs to exactly one App
 * (tenant). Two customers embedding ChatKonect must be unable to see, search,
 * add or message each other's users — and neither must be able to reach OUR
 * first-party accounts, or be reachable by them.
 *
 * One helper, applied at every point where a user is DISCOVERED (search) or
 * RESOLVED FROM AN ID supplied by the client (group members, meeting invitees,
 * key lookups). Those are the only two ways to reach a stranger; established
 * relationships (contacts, existing chat membership) are already bounded by
 * having been formed through one of them.
 */

/**
 * Mongo filter restricting a query to the caller's own tenant.
 *
 * First-party ChatKonect accounts have `app: null`, and `{ app: null }` also
 * matches documents where the field is absent — which is what every account
 * created before tenancy existed looks like. So this is correct for legacy rows
 * with no migration, and the isolation is bidirectional: our users don't see
 * tenant users either.
 *
 * @param {{app?: any}} user the authenticated caller (req.user)
 */
export function tenantScope(user) {
  return { app: user?.app ? user.app : null };
}

/** True when both users belong to the same tenant (or both are first-party). */
export function sameTenant(a, b) {
  return String(a?.app || '') === String(b?.app || '');
}
