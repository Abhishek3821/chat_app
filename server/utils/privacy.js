/**
 * Presence-privacy enforcement.
 *
 * Users can set who may see their `lastSeen` and `onlineStatus`:
 *   'everyone' | 'contacts' | 'nobody'
 * These helpers apply that setting when serializing a user for a given viewer,
 * so the API actually honours the toggles the Settings UI exposes (instead of
 * leaking presence to everyone regardless of the chosen value).
 */

/** Does `setting` permit this viewer, given whether they're a contact? */
function permits(setting, viewerIsContact) {
  if (setting === 'nobody') return false;
  if (setting === 'contacts') return !!viewerIsContact;
  return true; // 'everyone' | undefined (default open)
}

/**
 * Mutate & return a plain serialized user object, hiding presence fields the
 * viewer isn't allowed to see. Expects `obj.privacy` to be present; it is
 * deleted before returning so the privacy config never leaks to the client.
 */
export function applyPresencePrivacy(obj, viewerIsContact) {
  if (!obj) return obj;
  const privacy = obj.privacy || {};
  if (!permits(privacy.onlineStatus, viewerIsContact)) obj.isOnline = false;
  if (!permits(privacy.lastSeen, viewerIsContact)) obj.lastSeen = null;
  delete obj.privacy;
  delete obj.contacts;
  return obj;
}
