import { Router } from 'express';
import {
  getMyWorkspace,
  updateWorkspace,
  rotateInvite,
  setMemberRole,
  setMemberStatus,
  removeMember,
  transferOwnership,
} from '../controllers/workspaceController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.get('/me', getMyWorkspace);
router.patch('/me', updateWorkspace);
router.post('/me/invite/rotate', rotateInvite);
router.post('/me/transfer', transferOwnership);
router.patch('/me/members/:userId/role', setMemberRole);
router.patch('/me/members/:userId/status', setMemberStatus);
router.delete('/me/members/:userId', removeMember);

export default router;
