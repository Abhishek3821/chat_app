import { Router } from 'express';
import { getNotifications, markAllRead, markRead } from '../controllers/notificationController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.get('/', getNotifications);
router.patch('/read', markAllRead);
router.patch('/:id/read', markRead);

export default router;
