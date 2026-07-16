import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Workspace from '../models/Workspace.js';
import ContactRequest from '../models/ContactRequest.js';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import Status from '../models/Status.js';
import Notification from '../models/Notification.js';
import Call from '../models/Call.js';
import Meeting from '../models/Meeting.js';
import Report from '../models/Report.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { sessionCookieOptions } from '../utils/token.js';
import { emitToUser } from '../socket/index.js';
import { applyPresencePrivacy } from '../utils/privacy.js';

const PUBLIC_FIELDS = 'name username email avatar bio isOnline lastSeen accountStatus createdAt';
// PUBLIC_FIELDS plus the fields needed to evaluate presence privacy (stripped
// again by applyPresencePrivacy before the object is returned to the client).
const PUBLIC_WITH_PRIVACY = `${PUBLIC_FIELDS} privacy contacts`;

// GET /api/users/search?q=
export const searchUsers = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ success: true, users: [] });

  // GLOBAL reachability (WhatsApp-style): anyone can be found by their EXACT
  // email or username, across every workspace — you find someone you already
  // know by their identifier, then send a contact request. Within your OWN team
  // workspace, partial name/username/email search also works (a company
  // directory). There is deliberately NO partial cross-workspace search, so we
  // never expose a browsable global directory of every user.
  const term = q.toLowerCase();
  const orClauses = [{ email: term }, { username: term }];
  const ws = await Workspace.findById(req.user.workspace).select('type');
  if (ws && ws.type !== 'personal') {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    orClauses.push({ workspace: req.user.workspace, $or: [{ email: rx }, { username: rx }, { name: rx }] });
  }
  const match = { _id: { $ne: req.user._id, $nin: req.user.blockedUsers }, $or: orClauses };

  const users = await User.find(match).select(PUBLIC_WITH_PRIVACY).limit(20);
  const meId = String(req.user._id);
  const sanitized = users.map((u) => {
    const viewerIsContact = (u.contacts || []).some((c) => String(c) === meId);
    return applyPresencePrivacy(u.toObject(), viewerIsContact);
  });
  res.json({ success: true, users: sanitized });
});

// GET /api/users/:id
export const getUserById = asyncHandler(async (req, res) => {
  // Global reachability: any user is viewable by id (public fields only, with
  // presence/photo privacy applied below). Not a directory dump — you need the id.
  const user = await User.findById(req.params.id).select(PUBLIC_WITH_PRIVACY);
  if (!user) throw new ApiError(404, 'User not found.');
  const viewerIsContact = (user.contacts || []).some((c) => String(c) === String(req.user._id));
  res.json({ success: true, user: applyPresencePrivacy(user.toObject(), viewerIsContact) });
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

  const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });
  res.json({ success: true, user: user.toSafeJSON() });
});

// Whitelists so a client can't stuff arbitrary keys into these schemaless objects.
const PRIVACY_KEYS = ['lastSeen', 'profilePhoto', 'about', 'status', 'readReceipts', 'groupAddPermission', 'onlineStatus'];
const SETTINGS_KEYS = ['theme', 'accent', 'notifications', 'enterToSend'];
const THEME_VALUES = ['light', 'dark', 'system'];
const ACCENT_VALUES = ['indigo', 'violet', 'cyan', 'emerald', 'rose', 'amber'];

// PATCH /api/users/me/privacy
export const updatePrivacy = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  const next = { ...user.privacy };
  for (const k of PRIVACY_KEYS) if (req.body[k] !== undefined) next[k] = req.body[k];
  user.privacy = next;
  user.markModified('privacy');
  await user.save({ validateBeforeSave: false });
  res.json({ success: true, privacy: user.privacy });
});

// PATCH /api/users/me/settings
export const updateSettings = asyncHandler(async (req, res) => {
  if (req.body.theme !== undefined && !THEME_VALUES.includes(req.body.theme)) {
    throw new ApiError(400, 'Invalid theme.');
  }
  if (req.body.accent !== undefined && !ACCENT_VALUES.includes(req.body.accent)) {
    throw new ApiError(400, 'Invalid accent color.');
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
  const user = await User.findById(req.user._id)
    .populate('contacts', PUBLIC_FIELDS)
    .populate('favorites', PUBLIC_FIELDS);
  res.json({ success: true, contacts: user.contacts, favorites: user.favorites });
});

// POST /api/users/me/contacts/:id
// Contacts are CONSENT-BASED: this never adds a contact unilaterally (that would
// bypass the chat gate and leak status privacy). It sends a contact request.
export const addContact = asyncHandler(async (req, res) => {
  const targetId = req.params.id;
  if (targetId === String(req.user._id)) throw new ApiError(400, "You can't add yourself.");
  const target = await User.findById(targetId);
  if (!target) throw new ApiError(404, 'User not found.');
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
export const removeContact = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, {
    $pull: { contacts: req.params.id, favorites: req.params.id },
  });
  res.json({ success: true, message: 'Contact removed.' });
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
  res.json({ success: true, [req.params.action]: !has });
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
  res.setHeader('Content-Disposition', 'attachment; filename="chatconnect-export.json"');
  res.status(200).send(JSON.stringify(archive, null, 2));
});
