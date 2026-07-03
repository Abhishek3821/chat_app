import { Router } from 'express';
import { listKeys, createKey, revokeKey } from '../controllers/apiKeyController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect); // manage your own keys while logged in

router.get('/', listKeys);
router.post('/', createKey);
router.delete('/:id', revokeKey);

export default router;
