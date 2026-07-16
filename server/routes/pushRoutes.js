import { Router } from 'express';
import { getVapidKey, subscribe, unsubscribe } from '../controllers/pushController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.get('/key', getVapidKey);
router.post('/subscribe', subscribe);
router.post('/unsubscribe', unsubscribe);

export default router;
