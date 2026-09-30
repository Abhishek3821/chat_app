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
import {
  startInboxThread, myCustomerThreads, listInbox, getInboxThread, replyInbox,
  updateInbox, addInboxNote, listTasks, createTask, updateTask,
  listActivity, listGuests, createGuestInvite, revokeGuest,
} from '../controllers/workspaceToolsController.js';

const router = Router();
router.use(protect);

router.get('/customer/inbox', myCustomerThreads);
router.post('/:workspaceId/inbox', startInboxThread);
router.get('/me/inbox', listInbox);
router.get('/me/inbox/:id', getInboxThread);
router.post('/me/inbox/:id/replies', replyInbox);
router.patch('/me/inbox/:id', updateInbox);
router.post('/me/inbox/:id/notes', addInboxNote);
router.get('/me/tasks', listTasks);
router.post('/me/tasks', createTask);
router.patch('/me/tasks/:id', updateTask);
router.get('/me/activity', listActivity);
router.get('/me/guests', listGuests);
router.post('/me/guests/invites', createGuestInvite);
router.post('/me/guests/:id/revoke', revokeGuest);

router.get('/me', getMyWorkspace);
router.patch('/me', updateWorkspace);
router.post('/me/invite/rotate', rotateInvite);
router.post('/me/transfer', transferOwnership);
router.patch('/me/members/:userId/role', setMemberRole);
router.patch('/me/members/:userId/status', setMemberStatus);
router.delete('/me/members/:userId', removeMember);

export default router;
