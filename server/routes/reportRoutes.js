import { Router } from 'express';
import { createReport } from '../controllers/reportController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.post('/', createReport);

export default router;
