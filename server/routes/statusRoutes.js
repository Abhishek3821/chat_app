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
import { requireFeature } from '../utils/appAuth.js';

const router = Router();
router.use(protect);
// Embedded tenants only get capabilities their App has been granted; a
// first-party user has no tenant, so this is a no-op for them.
router.use(requireFeature('status'));

router.get('/', getStatusFeed);
router.post('/', createStatus);
router.post('/:id/view', viewStatus);
router.post('/:id/reply', replyStatus);
router.get('/:id/viewers', getViewers);
router.delete('/:id', deleteStatus);

export default router;
