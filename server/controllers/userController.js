import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { tenantScope, sameTenant } from '../utils/tenancy.js';
import ContactRequest from '../models/ContactRequest.js';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import Status from '../models/Status.js';
import Notification from '../models/Notification.js';
import Call from '../models/Call.js';
import Meeting from '../models/Meeting.js';
import Report from '../models/Report.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { getWorkspaceType } from '../utils/workspaceService.js';
import { sessionCookieOptions } from '../utils/token.js';
import { emitToUser } from '../socket/index.js';
import { applyPresencePrivacy } from '../utils/privacy.js';
import { applyPresenceFreshness } from '../utils/presence.js';
import { normalizePhone } from '../utils/sendSms.js';
import { invalidateChatListCache } from '../utils/chatCache.js';

const PUBLIC_FIELDS = 'name username email phone avatar bio isOnline lastSeen accountStatus createdAt';
// PUBLIC_FIELDS plus the fields needed to evaluate presence privacy (stripped
// again by applyPresencePrivacy before the object is returned to the client).
const PUBLIC_WITH_PRIVACY = `${PUBLIC_FIELDS} privacy contacts`;

// GET /api/users/search?q=
export const searchUsers = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ success: true, users: [] });

  // GLOBAL reachability (WhatsApp-style): anyone can be found by their EXACT
  // email, username or phone number, across every workspace — you find someone
  // you already know by their identifier, then send a contact request. Within
  // your OWN team workspace, partial name/username/email search also works (a
  // company directory). There is deliberately NO partial cross-workspace
  // search, so we never expose a browsable global directory of every user.
  const term = q.toLowerCase();
  const orClauses = [{ email: term }, { username: term }];
  const phoneTerm = normalizePhone(q);
  if (phoneTerm) {
    // Match with or without the leading "+" / country formatting differences.
    orClauses.push({ phone: phoneTerm });
    if (phoneTerm.startsWith('+')) orClauses.push({ phone: phoneTerm.slice(1) });
    else orClauses.push({ phone: `+${phoneTerm}` });
  }
  const wsType = await getWorkspaceType(req.user.workspace);
  if (wsType && wsType !== 'personal') {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    orClauses.push({ workspace: req.user.workspace, $or: [{ email: rx }, { username: rx }, { name: rx }] });
  }
  // tenantScope FIRST: user discovery is the primary way to reach a stranger, so
  // it must never cross an embedded tenant's boundary (utils/tenancy.js).
  const match = {
    ...tenantScope(req.user),
    _id: { $ne: req.user._id, $nin: req.user.blockedUsers },
    $or: orClauses,
  };

  const users = await User.find(match).select(PUBLIC_WITH_PRIVACY).limit(20).lean();
  const meId = String(req.user._id);
  const sanitized = users.map((u) => {
    const viewerIsContact = (u.contacts || []).some((c) => String(c) === meId);
    return applyPresencePrivacy(u, viewerIsContact);
  });
  res.json({ success: true, users: sanitized });
});

// GET /api/users/:id
export const getUserById = asyncHandler(async (req, res) => {
  // Global reachability: any user is viewable by id (public fields only, with
  // presence/photo privacy applied below). Not a directory dump — you need the id.
  const user = await User.findById(req.params.id).select(`${PUBLIC_WITH_PRIVACY} app`).lean();
  if (!user) throw new ApiError(404, 'User not found.');
  // "Global reachability" is a first-party product decision; it must not reach
  // ACROSS an embedded tenant. 404 rather than 403 so the endpoint can't be used
  // to probe which ids exist in another tenant.
  if (!sameTenant(user, req.user)) throw new ApiError(404, 'User not found.');
  const viewerIsContact = (user.contacts || []).some((c) => String(c) === String(req.user._id));
  res.json({ success: true, user: applyPresencePrivacy(user, viewerIsContact) });
});

// PATCH /api/users/me
export const updateProfile = asyncHandler(async (req, res) => {
  const allowed = ['name', 'bio', 'avatar', 'phone', 'username'];
  const updates = {};
  for (const key of allowed) if (req.body[key] !== undefined) updates[key] = req.body[key];

  // Validate avatar: a small image data-URL, an https URL, or empty. Guards
  // against document bloat and junk values.
  if (updates.avatar !== undefined) {
    const a = updates.avatar;
    const ok =
      typeof a === 'string' &&
      (a === '' ||
        (/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(a) && a.length <= 500_000) ||
        (/^https:\/\/\S+$/.test(a) && a.length <= 2048));
    if (!ok) throw new ApiError(400, 'Invalid avatar image.');
  }

  if (updates.username) {
    const clash = await User.findOne({ username: updates.username.toLowerCase(), _id: { $ne: req.user._id } });
    if (clash) throw new ApiError(409, 'That username is taken.');
  }

  // Phone: normalize + enforce one-number-one-account (same rule as signup).
  if (updates.phone !== undefined && updates.phone !== '') {
    const phone = normalizePhone(updates.phone);
    if (!phone) throw new ApiError(400, 'Please provide a valid phone number (7–15 digits).');
    const clash = await User.findOne({ phone, _id: { $ne: req.user._id } });
    if (clash) throw new ApiError(409, 'That phone number is already linked to another account.');
    updates.phone = phone;
  }

  const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });
  res.json({ success: true, user: user.toSafeJSON() });
});

// Whitelists so a client can't stuff arbitrary keys into these schemaless objects.
const PRIVACY_KEYS = ['lastSeen', 'profilePhoto', 'about', 'status', 'readReceipts', 'groupAddPermission', 'onlineStatus'];
const SETTINGS_KEYS = ['theme', 'accent', 'notifications', 'enterToSend', 'wallpaper'];
const THEME_VALUES = ['light', 'dark', 'system'];
// Keep in sync with User.settings.accent's enum and the client's ACCENTS list.
// 'teal' is the brand palette and the default.
const ACCENT_VALUES = ['teal', 'indigo', 'violet', 'cyan', 'emerald', 'rose', 'amber'];

/* Allowed shapes per privacy key. `privacy` is a free-form Object on the schema
   (so Mongoose validates nothing), and these values are READ by utils/privacy.js
   to decide who may see what. */
const AUDIENCE_VALUES = ['everyone', 'contacts', 'nobody'];
const AUDIENCE_KEYS = ['lastSeen', 'profilePhoto', 'about', 'status', 'onlineStatus'];
const BOOLEAN_KEYS = ['readReceipts'];
const GROUP_ADD_VALUES = ['everyone', 'contacts'];

// PATCH /api/users/me/privacy
export const updatePrivacy = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  const next = { ...user.privacy };

  /**
   * Validate every value before storing it.
   *
   * This used to accept ANYTHING: `{ lastSeen: 'sometimes' }` was saved verbatim.
   * That is not merely untidy — `permits()` in utils/privacy.js treats an
   * unrecognised value as 'everyone' (correct for an UNSET field), so a typo or a
   * tampered request silently made a user MORE public than they asked to be. A
   * privacy control that fails open is worse than one that is missing, because
   * the user believes it worked.
   */
  for (const k of PRIVACY_KEYS) {
    const v = req.body[k];
    if (v === undefined) continue;

    if (AUDIENCE_KEYS.includes(k)) {
      if (!AUDIENCE_VALUES.includes(v)) {
        throw new ApiError(400, `${k} must be one of: ${AUDIENCE_VALUES.join(', ')}.`);
      }
    } else if (BOOLEAN_KEYS.includes(k)) {
      if (typeof v !== 'boolean') throw new ApiError(400, `${k} must be true or false.`);
    } else if (k === 'groupAddPermission') {
      if (!GROUP_ADD_VALUES.includes(v)) {
        throw new ApiError(400, `groupAddPermission must be one of: ${GROUP_ADD_VALUES.join(', ')}.`);
      }
    }
    next[k] = v;
  }

  user.privacy = next;
  user.markModified('privacy');
  await user.save({ validateBeforeSave: false });
  res.json({ success: true, privacy: user.privacy });
});

const PRESENCE_STATES = ['available', 'away', 'busy', 'dnd'];
// PATCH /api/users/me/presence  { state }
export const updatePresence = asyncHandler(async (req, res) => {
  const state = String(req.body.state || '');
  if (!PRESENCE_STATES.includes(state)) throw new ApiError(400, 'Invalid presence state.');
  await User.updateOne({ _id: req.user._id }, { $set: { presenceState: state } });
  // Let contacts' clients update the dot live.
  emitToUser(String(req.user._id), 'presence-state', { userId: String(req.user._id), state });
  res.json({ success: true, presenceState: state });
});

// PATCH /api/users/me/settings
export const updateSettings = asyncHandler(async (req, res) => {
  if (req.body.theme !== undefined && !THEME_VALUES.includes(req.body.theme)) {
    throw new ApiError(400, 'Invalid theme.');
  }
  if (req.body.accent !== undefined && !ACCENT_VALUES.includes(req.body.accent)) {
    throw new ApiError(400, 'Invalid accent color.');
  }
  // Wallpapers are stored as a preset id owned by the client's catalogue, never
  // as CSS — same reasoning as setChatTheme. '' clears it.
  if (req.body.wallpaper !== undefined) {
    const w = String(req.body.wallpaper);
    if (w && (w.length > 64 || !/^[a-z0-9-]+$/i.test(w))) throw new ApiError(400, 'Invalid wallpaper id.');
  }
  const user = await User.findById(req.user._id);
  const current = user.settings.toObject?.() ?? user.settings;
  const next = { ...current };
  for (const k of SETTINGS_KEYS) if (req.body[k] !== undefined) next[k] = req.body[k];
  user.settings = next;
  user.markModified('settings');
  await user.save({ validateBeforeSave: false });
  res.json({ success: true, settings: user.settings });
});

// GET /api/users/me/contacts
export const getContacts = asyncHandler(async (req, res) => {
  // `protect` already loaded this exact user document — populate the
  // references directly ON IT instead of a second full `User.findById`.
  await req.user.populate([
    { path: 'contacts', select: PUBLIC_FIELDS },
    { path: 'favorites', select: PUBLIC_FIELDS },
  ]);
  /* Derive the online dot from the heartbeat rather than the stored flag — this
     list is the main place people notice presence being wrong, and the sweeper
     only runs once a minute. */
  const fresh = (docs) => (docs || []).map((d) => applyPresenceFreshness(d.toObject ? d.toObject() : d));
  res.json({ success: true, contacts: fresh(req.user.contacts), favorites: fresh(req.user.favorites) });
});

// POST /api/users/me/contacts/:id
// Contacts are CONSENT-BASED: this never adds a contact unilaterally (that would
// bypass the chat gate and leak status privacy). It sends a contact request.
export const addContact = asyncHandler(async (req, res) => {
  const targetId = req.params.id;
  if (targetId === String(req.user._id)) throw new ApiError(400, "You can't add yourself.");
  const target = await User.findById(targetId);
  if (!target) throw new ApiError(404, 'User not found.');
  // Tenant boundary first. The workspace comparison below can't carry this: for
  // two platform end users both sides are undefined, so it compares equal and
  // lets the request through — which would let one tenant's user add a user of
  // another tenant (or one of ours) purely from a known id.
  if (!sameTenant(target, req.user)) throw new ApiError(404, 'User not found.');
  if (String(target.workspace) !== String(req.user.workspace)) {
    throw new ApiError(403, 'You can only add people in your workspace.');
  }

  const blocked =
    (target.blockedUsers || []).some((b) => String(b) === String(req.user._id)) ||
    (req.user.blockedUsers || []).some((b) => String(b) === String(targetId));
  if (blocked) throw new ApiError(403, 'Unable to send a request to this user.');

  if ((req.user.contacts || []).some((c) => String(c) === String(targetId))) {
    return res.json({ success: true, message: 'Already a contact.' });
  }

  const existing = await ContactRequest.findOne({ from: req.user._id, to: targetId, status: 'pending' });
  if (!existing) {
    await ContactRequest.create({ from: req.user._id, to: targetId });
    emitToUser(String(targetId), 'contact-request', {
      from: { _id: req.user._id, name: req.user.name, avatar: req.user.avatar },
    });
  }
  res.status(201).json({ success: true, message: 'Contact request sent.' });
});

// DELETE /api/users/me/contacts/:id
/**
 * DELETE /api/users/me/contacts/:id — unfriend someone.
 *
 * MUTUAL by design. This used to pull the contact from the caller's list only,
 * which left the relationship half-dissolved: the other person still saw the
 * caller in their contacts, but messaging was already impossible because
 * `accessDirectChat` requires BOTH sides to hold each other. So they were left
 * with a contact they could not message and no way to understand why.
 *
 * A contact here IS a mutual relationship — mutual accept to create it, so mutual
 * removal to end it. Favourites are cleared on both sides too, otherwise a
 * starred entry for a non-contact lingers.
 *
 * Existing chats and their history are deliberately NOT deleted: unfriending is
 * not "erase what we said", and either side may still want their copy. The chat
 * simply cannot be re-opened until they reconnect.
 */
export const removeContact = asyncHandler(async (req, res) => {
  const otherId = req.params.id;
  if (!mongoose.isValidObjectId(otherId)) throw new ApiError(400, 'Invalid user id.');
  if (String(otherId) === String(req.user._id)) throw new ApiError(400, "You can't remove yourself.");

  const other = await User.findById(otherId).select('_id name');
  if (!other) throw new ApiError(404, 'User not found.');

  const wasContact = (req.user.contacts || []).some((c) => String(c) === String(otherId));

  await Promise.all([
    User.findByIdAndUpdate(req.user._id, { $pull: { contacts: otherId, favorites: otherId } }),
    User.findByIdAndUpdate(otherId, { $pull: { contacts: req.user._id, favorites: req.user._id } }),
  ]);

  /* Tell the other side live, so their contact list and any open chat header
     update without a reload — the same standard every other mutation here meets.
     Their own devices get it too, hence emitToUser for both. */
  emitToUser(String(otherId), 'contact-removed', {
    userId: String(req.user._id),
    by: req.user.name,
  });
  emitToUser(String(req.user._id), 'contact-removed', { userId: String(otherId) });

  res.json({
    success: true,
    removed: true,
    // Reported so the client can stay quiet when nothing actually changed
    // (a double-tap, or a stale list) instead of claiming a removal happened.
    wasContact,
    message: wasContact ? `${other.name} removed from your contacts.` : 'Not in your contacts.',
  });
});

// POST /api/users/me/favorites/:id  (toggle)
export const toggleFavorite = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  const id = req.params.id;
  const has = user.favorites.some((f) => String(f) === id);
  await User.findByIdAndUpdate(req.user._id, has ? { $pull: { favorites: id } } : { $addToSet: { favorites: id } });
  res.json({ success: true, favorited: !has });
});

// POST /api/users/me/block/:id  (toggle)
export const toggleBlock = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  const id = req.params.id;
  const has = user.blockedUsers.some((b) => String(b) === id);
  await User.findByIdAndUpdate(req.user._id, has ? { $pull: { blockedUsers: id } } : { $addToSet: { blockedUsers: id } });
  res.json({ success: true, blocked: !has });
});

// POST /api/users/me/chats/:chatId/pin|archive|mute  (toggle via :action param)
export const toggleChatFlag = asyncHandler(async (req, res) => {
  const map = { pin: 'pinnedChats', archive: 'archivedChats', mute: 'mutedChats' };
  const field = map[req.params.action];
  if (!field) throw new ApiError(400, 'Unknown action.');
  const user = await User.findById(req.user._id);
  const id = req.params.chatId;
  const has = user[field].some((c) => String(c) === id);
  await User.findByIdAndUpdate(req.user._id, has ? { $pull: { [field]: id } } : { $addToSet: { [field]: id } });
  const value = !has;
  // These flags are per-user, not per-chat, so no other participant should hear
  // about them — but every one of MY OWN devices must. Without this, archiving a
  // chat on your phone left it un-archived on your laptop until a full reload.
  emitToUser(String(req.user._id), 'chat-flag', { chatId: id, action: req.params.action, value });
  res.json({ success: true, [req.params.action]: value });
});

/**
 * PUT /api/users/me/chats/:chatId/theme  { wallpaper, bubble }
 *
 * Per-chat wallpaper. Personal to the caller — WhatsApp semantics: changing
 * yours doesn't touch what the other side sees, so this lives on the User doc
 * as a sparse override list rather than on the shared Chat.
 *
 * Sending an empty `wallpaper` clears the override, and the row is REMOVED
 * rather than stored blank, so `chatThemes` only ever holds real customisations
 * and never grows one entry per chat you happen to open.
 *
 * The value is a preset id, not CSS: the client owns the catalogue, and letting
 * a client store arbitrary style strings that other surfaces then render is how
 * you get a CSS-injection vector.
 */
export const setChatTheme = asyncHandler(async (req, res) => {
  const chatId = req.params.chatId;
  // You can only theme a conversation you're actually in.
  const isMember = await Chat.exists({ _id: chatId, 'participants.user': req.user._id });
  if (!isMember) throw new ApiError(403, 'You are not a participant of this chat.');

  const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const wallpaper = clean(req.body.wallpaper, 64);
  const bubble = clean(req.body.bubble, 32);
  if (wallpaper && !/^[a-z0-9-]+$/i.test(wallpaper)) throw new ApiError(400, 'Invalid wallpaper id.');
  if (bubble && !/^[a-z0-9-]+$/i.test(bubble)) throw new ApiError(400, 'Invalid bubble id.');

  if (!wallpaper && !bubble) {
    await User.findByIdAndUpdate(req.user._id, { $pull: { chatThemes: { chat: chatId } } });
  } else {
    // Upsert-in-place: try to update an existing row, and only push when there
    // wasn't one. Two cheap indexed writes beat read-modify-write on the doc.
    const updated = await User.updateOne(
      { _id: req.user._id, 'chatThemes.chat': chatId },
      { $set: { 'chatThemes.$.wallpaper': wallpaper, 'chatThemes.$.bubble': bubble, 'chatThemes.$.updatedAt': new Date() } }
    );
    if (!updated.matchedCount) {
      await User.findByIdAndUpdate(req.user._id, {
        $push: { chatThemes: { chat: chatId, wallpaper, bubble, updatedAt: new Date() } },
      });
    }
  }

  // Same reasoning as toggleChatFlag: a personal setting nobody else should
  // hear about, but every one of MY devices should.
  emitToUser(String(req.user._id), 'chat-theme', { chatId, wallpaper, bubble });
  invalidateChatListCache(req.user._id); // getChats embeds the theme on each row
  res.json({ success: true, wallpaper, bubble });
});

// The two-step PIN (app lock) itself is enabled/disabled/verified in
// authController at /auth/two-step/*. This helper lets chat lock reuse the same
// PIN to gate revealing locked chats. Matches authController's 4–8 digit rule.
export async function verifyTwoStepPin(userId, pin) {
  if (!/^\d{4,8}$/.test(String(pin || ''))) return false;
  const user = await User.findById(userId).select('+twoStepPin twoStepEnabled');
  if (!user || !user.twoStepEnabled || !user.twoStepPin) return false;
  return bcrypt.compare(String(pin), user.twoStepPin);
}

// DELETE /api/users/me
// GDPR-style erasure: remove the account AND the data it produced / references to
// it, instead of leaving orphaned PII behind. Best-effort, sequential; for very
// large accounts this belongs in a background job/transaction, but this closes
// the "findByIdAndDelete only" gap.
export const deleteAccount = asyncHandler(async (req, res) => {
  const uid = req.user._id;

  // Chats the user belongs to: drop 1:1 chats (and their messages) entirely;
  // for groups, remove the user and keep the conversation for the others.
  const chats = await Chat.find({ 'participants.user': uid }).select('participants isGroup');
  for (const chat of chats) {
    const remaining = chat.participants.filter((p) => String(p.user) !== String(uid));
    if (!chat.isGroup || remaining.length === 0) {
      await Message.deleteMany({ chat: chat._id });
      await Chat.deleteOne({ _id: chat._id });
    } else {
      chat.participants = remaining;
      if (!chat.participants.some((p) => p.role === 'owner')) chat.participants[0].role = 'owner';
      await chat.save();
    }
  }

  await Promise.all([
    Message.deleteMany({ sender: uid }), // their messages in surviving group chats
    Status.deleteMany({ user: uid }),
    ContactRequest.deleteMany({ $or: [{ from: uid }, { to: uid }] }),
    Notification.deleteMany({ $or: [{ user: uid }, { from: uid }] }),
    Call.deleteMany({ $or: [{ initiator: uid }, { 'participants.user': uid }] }),
    Meeting.deleteMany({ host: uid }),
    Meeting.updateMany({ 'participants.user': uid }, { $pull: { participants: { user: uid } } }),
    Report.deleteMany({ reporter: uid }),
    // Scrub references to this user from everyone else.
    User.updateMany(
      { $or: [{ contacts: uid }, { favorites: uid }, { blockedUsers: uid }] },
      { $pull: { contacts: uid, favorites: uid, blockedUsers: uid } }
    ),
  ]);

  await User.findByIdAndDelete(uid);
  res.cookie('token', '', { ...sessionCookieOptions(), expires: new Date(0) });
  res.json({ success: true, message: 'Account and associated data deleted.' });
});

// GET /api/users/me/export — a downloadable JSON archive of the user's own data.
// Only the caller's OWN messages are included (never other people's), so this
// can't be used to exfiltrate a conversation partner's content.
export const exportData = asyncHandler(async (req, res) => {
  const uid = req.user._id;
  const [user, contacts, chats] = await Promise.all([
    User.findById(uid).lean(),
    User.find({ _id: { $in: req.user.contacts || [] } }).select('name username email').lean(),
    Chat.find({ 'participants.user': uid }).select('isGroup name createdAt').lean(),
  ]);
  const myMessages = await Message.find({ sender: uid })
    .select('chat type content createdAt')
    .sort({ createdAt: 1 })
    .lean();

  const archive = {
    exportedAt: new Date().toISOString(),
    profile: {
      name: user.name,
      username: user.username,
      email: user.email,
      bio: user.bio,
      phone: user.phone,
      createdAt: user.createdAt,
    },
    contacts: contacts.map((c) => ({ name: c.name, username: c.username, email: c.email })),
    chats: chats.map((c) => ({ id: String(c._id), type: c.isGroup ? 'group' : 'direct', name: c.name || null, createdAt: c.createdAt })),
    messages: myMessages.map((m) => ({ chat: String(m.chat), type: m.type, content: m.content, at: m.createdAt })),
    counts: { contacts: contacts.length, chats: chats.length, messages: myMessages.length },
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="chatkonect-export.json"');
  res.status(200).send(JSON.stringify(archive, null, 2));
});
