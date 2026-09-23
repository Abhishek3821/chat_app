import { Router } from 'express';
import { getStats, listUsers, setUserStatus, deleteUser, listReports, updateReport } from '../controllers/adminController.js';
import { protect, adminOnly } from '../middleware/auth.js';

const router = Router();
router.use(protect, adminOnly);

router.get('/stats', getStats);
router.get('/users', listUsers);
router.patch('/users/:id/status', setUserStatus);
router.delete('/users/:id', deleteUser);
router.get('/reports', listReports);
router.patch('/reports/:id', updateReport);

export default router;
