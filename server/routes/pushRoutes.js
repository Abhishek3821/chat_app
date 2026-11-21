import { Router } from 'express';
import {
  getVapidKey,
  subscribe,
  unsubscribe,
  fcmStatus,
  registerFcmToken,
  unregisterFcmToken,
} from '../controllers/pushController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.get('/key', getVapidKey);
router.post('/subscribe', subscribe);
router.post('/unsubscribe', unsubscribe);

// Native app (Firebase Cloud Messaging) device tokens
router.get('/fcm/status', fcmStatus);
router.post('/fcm/register', registerFcmToken);
router.post('/fcm/unregister', unregisterFcmToken);

export default router;
