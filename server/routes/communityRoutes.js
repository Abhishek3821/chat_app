import { Router } from 'express';
import {
  createCommunity,
  listCommunities,
  getCommunity,
  addGroupToCommunity,
  joinCommunity,
  leaveCommunity,
} from '../controllers/communityController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.post('/', createCommunity);
router.get('/', listCommunities);
router.post('/join/:inviteCode', joinCommunity);
router.get('/:id', getCommunity);
router.post('/:id/groups', addGroupToCommunity);
router.post('/:id/leave', leaveCommunity);

export default router;
