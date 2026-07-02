import { Router } from 'express';
import { sendRequest, getRequests, respondRequest } from '../controllers/contactController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.get('/requests', getRequests);
router.post('/request/:userId', sendRequest);
router.patch('/request/:id', respondRequest);

export default router;
