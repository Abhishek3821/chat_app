import User from '../models/User.js';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import Meeting from '../models/Meeting.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { applyPresencePrivacy } from '../utils/privacy.js';
import { normalizePhone } from '../utils/sendSms.js';

/**
 * One search across everything the signed-in user can see: people, chats,
 * messages and meetings. Backs the header search box, which until now was an
 * input wired to nothing.
 *
 * Scale notes, because this is a hot path fired on every keystroke (debounced):
 *  • Every branch runs in parallel and is individually capped — the response is
 *    bounded no matter how big the account is.
 *  • Messages are matched with the `content` text index first. A text index only
 *    matches whole terms, so a short/partial query falls back to a regex — but
 *    that fallback is always bounded by `chat: {$in: myChatIds}`, which rides
 *    the `{chat:1, createdAt:-1}` index instead of scanning the collection.
 *  • `myChatIds` is fetched once and reused by the chat + message branches.
 *
 * Privacy rules it inherits rather than reinvents:
 *  • Locked chats (the PIN-hidden ones) are excluded everywhere — surfacing
 *    their messages in search would walk straight around the lock.
 *  • Encrypted chats can't be matched server-side at all (the server holds only
 *    ciphertext); the client searches those locally. `encryptedChats` in the
 *    response tells it which ones it still owes the user an answer for.
 *  • People search keeps the existing reachability rule: partial matching over
 *    your own contacts, exact-identifier matching globally. No browsable
 *    directory of every user on the platform.
 */

const LIMITS = { people: 6, chats: 6, messages: 12, meetings: 5 };
const MAX_QUERY = 128;

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const globalSearch = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, MAX_QUERY);
  if (q.length < 2) {
    return res.json({ success: true, query: q, people: [], chats: [], messages: [], meetings: [], encryptedChats: [] });
  }

  const meId = req.user._id;
  const rx = new RegExp(escapeRx(q), 'i');
  const term = q.toLowerCase();
  const locked = (req.user.lockedChats || []).map(String);

  // Every chat I'm in, minus the locked ones. Bounded by how many chats a person
  // is actually in, and both other branches need it.
  const myChats = await Chat.find({ 'participants.user': meId, _id: { $nin: locked } })
    .select('_id name isGroup avatar participants e2ee.enabled updatedAt')
    .sort({ updatedAt: -1 })
    .lean();

  const searchableChatIds = myChats.filter((c) => !c.e2ee?.enabled).map((c) => c._id);
  const encryptedChatIds = myChats.filter((c) => c.e2ee?.enabled).map((c) => String(c._id));

  const [people, messages, meetings] = await Promise.all([
    searchPeople({ req, q, term, rx }),
    searchMessagesAcrossChats({ meId, q, rx, chatIds: searchableChatIds }),
    Meeting.find({
      $or: [{ host: meId }, { 'participants.user': meId }],
      title: rx,
    })
      .select('title startAt type roomCode link host durationMinutes')
      .populate('host', 'name username avatar')
      .sort({ startAt: -1 })
      .limit(LIMITS.meetings)
      .lean(),
  ]);

  // Chats: group chats by their own name, plus the direct chats I have with the
  // people the query just matched (searching a person should surface the thread).
  const peopleIds = new Set(people.map((p) => String(p._id)));
  const chats = myChats
    .filter((c) =>
      c.isGroup
        ? rx.test(c.name || '')
        : (c.participants || []).some((p) => {
            const id = String(p.user?._id || p.user);
            return id !== String(meId) && peopleIds.has(id);
          })
    )
    .slice(0, LIMITS.chats);

  // Hydrate the direct-chat peers so the client can label the row without a
  // second round trip.
  const populatedChats = await Chat.populate(chats, {
    path: 'participants.user',
    select: 'name username avatar isOnline',
  });

  res.json({
    success: true,
    query: q,
    people,
    chats: populatedChats,
    messages,
    meetings,
    // The client searches these locally against its decrypted cache.
    encryptedChats: encryptedChatIds,
  });
});

/** People: partial over your contacts, exact identifier globally. */
async function searchPeople({ req, q, term, rx }) {
  const contactIds = req.user.contacts || [];
  const orClauses = [
    // Partial match, but only within people you're already connected to.
    { _id: { $in: contactIds }, $or: [{ name: rx }, { username: rx }] },
    // Exact identifier match, anywhere (how you find someone new).
    { email: term },
    { username: term },
  ];
  const phone = normalizePhone(q);
  if (phone) {
    orClauses.push({ phone });
    orClauses.push({ phone: phone.startsWith('+') ? phone.slice(1) : `+${phone}` });
  }

  const users = await User.find({
    _id: { $ne: req.user._id, $nin: req.user.blockedUsers || [] },
    $or: orClauses,
  })
    .select('name username email avatar bio isOnline lastSeen privacy contacts')
    .limit(LIMITS.people)
    .lean();

  const meId = String(req.user._id);
  const contactSet = new Set(contactIds.map(String));
  return users.map((u) => ({
    ...applyPresencePrivacy(u, (u.contacts || []).some((c) => String(c) === meId)),
    isContact: contactSet.has(String(u._id)),
    contacts: undefined,
    privacy: undefined,
  }));
}

/**
 * Messages across every (unlocked, unencrypted) chat I'm in. Text index first,
 * regex only to top up — see the scale note at the top of the file.
 */
async function searchMessagesAcrossChats({ meId, q, rx, chatIds }) {
  if (!chatIds.length) return [];
  const base = {
    chat: { $in: chatIds },
    isDeleted: false,
    deletedFor: { $ne: meId },
    encrypted: { $ne: true },
  };

  /* The `content` text index is the fast path, but it is not guaranteed to
     exist at query time: Mongo builds indexes asynchronously after the model
     registers, a deployment may run with autoIndex off, and a restored/rebuilt
     collection starts without it. `$text` against a collection with no text
     index doesn't return nothing — it THROWS, and that used to take the whole
     search endpoint down with a 500 (all four sections, not just messages).
     So: try the index, and degrade to the regex path if it isn't there. */
  let byText = [];
  try {
    byText = await Message.find({ ...base, $text: { $search: q } })
      .select('chat sender content type createdAt attachments')
      .sort({ createdAt: -1 })
      .limit(LIMITS.messages)
      .lean();
  } catch (err) {
    if (!/text index required/i.test(err?.message || '')) throw err;
  }

  let results = byText;
  if (results.length < LIMITS.messages) {
    const seen = new Set(results.map((m) => String(m._id)));
    const byRegex = await Message.find({ ...base, _id: { $nin: [...seen] }, content: rx })
      .select('chat sender content type createdAt attachments')
      .sort({ createdAt: -1 })
      .limit(LIMITS.messages - results.length)
      .lean();
    results = [...results, ...byRegex];
  }

  return Message.populate(results, [
    { path: 'sender', select: 'name username avatar' },
    { path: 'chat', select: 'name isGroup avatar participants', populate: { path: 'participants.user', select: 'name avatar' } },
  ]);
}
