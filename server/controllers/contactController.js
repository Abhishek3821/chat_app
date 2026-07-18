import ContactRequest from '../models/ContactRequest.js';
import User from '../models/User.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { emitToUser } from '../socket/index.js';
import { notifyUser } from '../utils/notify.js';

const USER_FIELDS = 'name username email avatar bio isOnline lastSeen';

// POST /api/contacts/request/:userId
export const sendRequest = asyncHandler(async (req, res) => {
  const to = req.params.userId;
  if (to === String(req.user._id)) throw new ApiError(400, "You can't add yourself.");
  const target = await User.findById(to);
  if (!target) throw new ApiError(404, 'User not found.');
  // Global reachability: contact requests may cross workspace/personal boundaries.

  // Respect blocks in both directions.
  const blocked =
    (target.blockedUsers || []).some((b) => String(b) === String(req.user._id)) ||
    (req.user.blockedUsers || []).some((b) => String(b) === String(to));
  if (blocked) throw new ApiError(403, 'Unable to send a request to this user.');

  if ((req.user.contacts || []).some((c) => String(c) === String(to))) {
    throw new ApiError(409, 'You are already connected.');
  }

  // If they already sent ME a pending request, connect immediately instead.
  const reverse = await ContactRequest.findOne({ from: to, to: req.user._id, status: 'pending' });
  if (reverse) {
    reverse.status = 'accepted';
    await reverse.save();
    await User.findByIdAndUpdate(req.user._id, { $addToSet: { contacts: to } });
    await User.findByIdAndUpdate(to, { $addToSet: { contacts: req.user._id } });
    emitToUser(to, 'contact-accepted', { by: req.user.name });
    notifyUser(to, {
      from: req.user._id,
      type: 'contact_request',
      title: 'Contact request accepted',
      body: `${req.user.name} accepted your contact request.`,
      tag: `contact:${req.user._id}`,
      url: '/contacts',
    });
    return res.status(200).json({ success: true, request: reverse, autoAccepted: true });
  }

  // Reuse a stale (rejected/accepted) request doc so the unique index doesn't 500,
  // and so a rejection doesn't permanently block re-sending.
  let request = await ContactRequest.findOne({ from: req.user._id, to });
  if (request) {
    if (request.status === 'pending') throw new ApiError(409, 'Request already sent.');
    request.status = 'pending';
    request.message = req.body.message || '';
    await request.save();
  } else {
    request = await ContactRequest.create({ from: req.user._id, to, message: req.body.message });
  }
  emitToUser(to, 'contact-request', { from: { _id: req.user._id, name: req.user.name, avatar: req.user.avatar } });
  notifyUser(to, {
    from: req.user._id,
    type: 'contact_request',
    title: 'New contact request',
    body: `${req.user.name} wants to connect with you.`,
    tag: `contact:${req.user._id}`,
    url: '/contacts',
  });
  res.status(201).json({ success: true, request });
});

// GET /api/contacts/requests
export const getRequests = asyncHandler(async (req, res) => {
  const incoming = await ContactRequest.find({ to: req.user._id, status: 'pending' }).populate('from', USER_FIELDS);
  const outgoing = await ContactRequest.find({ from: req.user._id, status: 'pending' }).populate('to', USER_FIELDS);
  res.json({ success: true, incoming, outgoing });
});

// PATCH /api/contacts/request/:id  { action: 'accept'|'reject' }
export const respondRequest = asyncHandler(async (req, res) => {
  const { action } = req.body;
  const request = await ContactRequest.findById(req.params.id);
  if (!request || String(request.to) !== String(req.user._id)) throw new ApiError(404, 'Request not found.');
  if (request.status !== 'pending') throw new ApiError(400, 'This request has already been handled.');

  if (action === 'accept') {
    request.status = 'accepted';
    await request.save();
    await User.findByIdAndUpdate(request.from, { $addToSet: { contacts: request.to } });
    await User.findByIdAndUpdate(request.to, { $addToSet: { contacts: request.from } });
    emitToUser(String(request.from), 'contact-accepted', { by: req.user.name });
    notifyUser(request.from, {
      from: req.user._id,
      type: 'contact_request',
      title: 'Contact request accepted',
      body: `${req.user.name} accepted your contact request.`,
      tag: `contact:${req.user._id}`,
      url: '/contacts',
    });
  } else {
    request.status = 'rejected';
    await request.save();
  }
  res.json({ success: true, request });
});
