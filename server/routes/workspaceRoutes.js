import { Router } from 'express';
import { getMyWorkspace, updateWorkspace, rotateInvite, setMemberRole } from '../controllers/workspaceController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.get('/me', getMyWorkspace);
router.patch('/me', updateWorkspace);
router.post('/me/invite/rotate', rotateInvite);
router.patch('/me/members/:userId/role', setMemberRole);

export default router;
