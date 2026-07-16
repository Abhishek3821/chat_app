import { Router } from 'express';
import {
  getChats,
  accessDirectChat,
  getChatById,
  clearChat,
  deleteChat,
  setDisappearing,
  lockChat,
  unlockChat,
  getLockedChats,
} from '../controllers/chatController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.get('/', getChats);
router.post('/locked', getLockedChats); // reveal locked chats (PIN in body)
router.post('/direct/:userId', accessDirectChat);
router.post('/:id/lock', lockChat);
router.post('/:id/unlock', unlockChat);
router.get('/:id', getChatById);
router.patch('/:id/disappearing', setDisappearing);
router.delete('/:id/clear', clearChat);
router.delete('/:id', deleteChat);

export default router;
