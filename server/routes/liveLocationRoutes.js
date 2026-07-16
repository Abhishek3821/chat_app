import { Router } from 'express';
import {
  startLiveLocation,
  updateLiveLocation,
  stopLiveLocation,
  getActiveLiveLocations,
} from '../controllers/liveLocationController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.post('/start', startLiveLocation);
router.get('/:chatId/active', getActiveLiveLocations);
router.post('/:messageId/update', updateLiveLocation);
router.post('/:messageId/stop', stopLiveLocation);

export default router;
