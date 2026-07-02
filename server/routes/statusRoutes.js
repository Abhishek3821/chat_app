import { Router } from 'express';
import {
  createStatus,
  getStatusFeed,
  viewStatus,
  replyStatus,
  getViewers,
  deleteStatus,
} from '../controllers/statusController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.get('/', getStatusFeed);
router.post('/', createStatus);
router.post('/:id/view', viewStatus);
router.post('/:id/reply', replyStatus);
router.get('/:id/viewers', getViewers);
router.delete('/:id', deleteStatus);

export default router;
