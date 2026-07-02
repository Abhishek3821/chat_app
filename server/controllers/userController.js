import User from '../models/User.js';
import ContactRequest from '../models/ContactRequest.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { emitToUser } from '../socket/index.js';

const PUBLIC_FIELDS = 'name username email avatar bio isOnline lastSeen accountStatus createdAt';

// GET /api/users/search?q=
export const searchUsers = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ success: true, users: [] });

  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const users = await User.find({
    _id: { $ne: req.user._id, $nin: req.user.blockedUsers },
    $or: [{ email: rx }, { username: rx }, { name: rx }],
  })
    .select(PUBLIC_FIELDS)
    .limit(20);

  res.json({ success: true, users });
});

// GET /api/users/:id
export const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select(PUBLIC_FIELDS);
  if (!user) throw new ApiError(404, 'User not found.');
  res.json({ success: true, user });
});

// PATCH /api/users/me
export const updateProfile = asyncHandler(async (req, res) => {
  const allowed = ['name', 'bio', 'avatar', 'phone', 'username'];
  const updates = {};
  for (const key of allowed) if (req.body[key] !== undefined) updates[key] = req.body[key];

  if (updates.username) {
    const clash = await User.findOne({ username: updates.username.toLowerCase(), _id: { $ne: req.user._id } });
    if (clash) throw new ApiError(409, 'That username is taken.');
  }

  const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });
  res.json({ success: true, user: user.toSafeJSON() });
});

// Whitelists so a client can't stuff arbitrary keys into these schemaless objects.
const PRIVACY_KEYS = ['lastSeen', 'profilePhoto', 'about', 'status', 'readReceipts', 'groupAddPermission', 'onlineStatus'];
const SETTINGS_KEYS = ['theme', 'notifications', 'enterToSend'];

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

// DELETE /api/users/me
export const deleteAccount = asyncHandler(async (req, res) => {
  await User.findByIdAndDelete(req.user._id);
  res.cookie('token', '', { httpOnly: true, expires: new Date(0) });
  res.json({ success: true, message: 'Account deleted.' });
});
