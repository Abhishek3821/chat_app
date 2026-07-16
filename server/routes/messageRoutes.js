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
  togglePin,
  createPoll,
  votePoll,
  markViewed,
} from '../controllers/messageController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.post('/', sendMessage);
router.post('/poll', createPoll);
router.post('/read', markRead);
router.get('/starred', getStarred);
router.get('/:chatId', getMessages);
router.get('/:chatId/search', searchMessages);
router.patch('/:id', editMessage);
router.delete('/:id', deleteMessage);
router.post('/:id/react', reactToMessage);
router.post('/:id/star', toggleStar);
router.post('/:id/pin', togglePin);
router.post('/:id/vote', votePoll);
router.post('/:id/viewed', markViewed);

export default router;
