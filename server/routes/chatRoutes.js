import { Router } from 'express';
import { getChats, accessDirectChat, getChatById, clearChat, deleteChat } from '../controllers/chatController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.get('/', getChats);
router.post('/direct/:userId', accessDirectChat);
router.get('/:id', getChatById);
router.delete('/:id/clear', clearChat);
router.delete('/:id', deleteChat);

export default router;
