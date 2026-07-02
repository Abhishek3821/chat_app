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

const router = Router();
router.use(protect);

router.post('/', createGroup);
router.post('/join/:inviteCode', joinByInvite);
router.patch('/:id', updateGroup);
router.post('/:id/members', addMembers);
router.delete('/:id/members/:userId', removeMember);
router.patch('/:id/members/:userId/role', setMemberRole);
router.post('/:id/leave', leaveGroup);

export default router;
