import { Router } from 'express';
import {
  getMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  reactToMessage,
  toggleStar,
  getStarred,
  markRead,
  searchMessages,
  getMessageContext,
  pinMessage,
  unpinMessage,
  getPins,
  createPoll,
  votePoll,
  markViewed,
  scheduleMessage,
  listScheduled,
  cancelScheduled,
} from '../controllers/messageController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.post('/', sendMessage);
router.post('/poll', createPoll);
router.post('/read', markRead);
router.get('/starred', getStarred);
// Scheduled messages. These MUST stay above `GET /:chatId` — that route is a
// catch-all and would otherwise swallow '/scheduled' as a chat id.
router.post('/schedule', scheduleMessage);
router.get('/scheduled/:chatId', listScheduled);
router.delete('/scheduled/:id', cancelScheduled);
router.get('/:chatId', getMessages);
router.get('/:chatId/search', searchMessages);
// Live pinned messages for a chat (also bundled into GET /:chatId's first page).
router.get('/:chatId/pins', getPins);
// Window of messages around one message — backs "jump to search result".
router.get('/:chatId/context/:messageId', getMessageContext);
router.patch('/:id', editMessage);
router.delete('/:id', deleteMessage);
router.post('/:id/react', reactToMessage);
router.post('/:id/star', toggleStar);
// Pin carries a duration, so it is POST-with-a-body and DELETE — not a toggle.
// A toggle can't express "extend this pin to 24h", and a client that lost track
// of the current state would flip it the wrong way.
router.post('/:id/pin', pinMessage);
router.delete('/:id/pin', unpinMessage);
router.post('/:id/vote', votePoll);
router.post('/:id/viewed', markViewed);

export default router;
