import { Router } from 'express';
import { apiKeyAuth, apiV1Limiter } from '../middleware/apiKey.js';
import { getChats, accessDirectChat } from '../controllers/chatController.js';
import { getMessages, sendMessage } from '../controllers/messageController.js';
import { getContacts, searchUsers } from '../controllers/userController.js';
import { startCall } from '../controllers/callController.js';
import { getMeetings, createMeeting } from '../controllers/meetingController.js';

/**
 * Public, versioned API for third-party integrations.
 *
 * Auth: send `X-API-Key: cc_live_…`. The key acts as its owner user, so every
 * handler here is the SAME already-secured controller the app uses — a key can
 * only ever touch data its owner could. Each route declares the scope it needs.
 */
const router = Router();
router.use(apiV1Limiter);

// Identity / health for a key — no scope required beyond a valid key.
router.get('/me', apiKeyAuth(), (req, res) =>
  res.json({ success: true, user: req.user.toSafeJSON(), scopes: req.apiKey.scopes })
);

// Contacts
router.get('/contacts', apiKeyAuth(['contacts:read']), getContacts);
router.get('/users/search', apiKeyAuth(['contacts:read']), searchUsers);

// Chats + messages
router.get('/chats', apiKeyAuth(['chat:read']), getChats);
router.post('/chats/direct/:userId', apiKeyAuth(['chat:write']), accessDirectChat);
router.get('/messages/:chatId', apiKeyAuth(['chat:read']), getMessages);
router.post('/messages', apiKeyAuth(['chat:write']), sendMessage);

// Calls
router.post('/calls', apiKeyAuth(['calls:write']), startCall);

// Meetings
router.get('/meetings', apiKeyAuth(['meetings:read']), getMeetings);
router.post('/meetings', apiKeyAuth(['meetings:write']), createMeeting);

export default router;
