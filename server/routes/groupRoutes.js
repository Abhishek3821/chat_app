import { Router } from 'express';
import {
  createGroup,
  updateGroup,
  addMembers,
  removeMember,
  setMemberRole,
  leaveGroup,
  joinByInvite,
} from '../controllers/groupController.js';
import { protect } from '../middleware/auth.js';
import { requireFeature } from '../utils/appAuth.js';

const router = Router();
router.use(protect);
// Embedded tenants only get capabilities their App has been granted; a
// first-party user has no tenant, so this is a no-op for them.
router.use(requireFeature('groups'));

router.post('/', createGroup);
router.post('/join/:inviteCode', joinByInvite);
router.patch('/:id', updateGroup);
router.post('/:id/members', addMembers);
router.delete('/:id/members/:userId', removeMember);
router.patch('/:id/members/:userId/role', setMemberRole);
router.post('/:id/leave', leaveGroup);

export default router;
