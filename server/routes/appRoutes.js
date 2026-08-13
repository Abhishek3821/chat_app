import express from 'express';
import { protect } from '../middleware/auth.js';
import {
  listApps,
  createApp,
  updateApp,
  rotateAppSecret,
  disableApp,
  appStats,
} from '../controllers/platformController.js';

/**
 * Tenant ("App") management for the ChatKonect admin console — session
 * authenticated. Every handler scopes to apps the caller OWNS, except for
 * platform admins (role === 'admin'), who see all of them.
 *
 * Mounted at /api/apps.
 */
const router = express.Router();

router.use(protect);

router.route('/').get(listApps).post(createApp);
router.route('/:id').patch(updateApp).delete(disableApp);
router.get('/:id/stats', appStats);
router.post('/:id/rotate', rotateAppSecret);

export default router;
