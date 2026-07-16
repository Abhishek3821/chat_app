import { Router } from 'express';
import {
  listBroadcasts,
  createBroadcast,
  updateBroadcast,
  deleteBroadcast,
  sendBroadcast,
} from '../controllers/broadcastController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.get('/', listBroadcasts);
router.post('/', createBroadcast);
router.post('/:id/send', sendBroadcast);
router.patch('/:id', updateBroadcast);
router.delete('/:id', deleteBroadcast);

export default router;
