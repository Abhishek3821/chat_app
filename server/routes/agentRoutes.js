import { Router } from 'express';
import {
  listLabels,
  createLabel,
  deleteLabel,
  applyLabel,
  getChatLabels,
  listQuickReplies,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
} from '../controllers/agentController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

// Labels
router.get('/labels', listLabels);
router.post('/labels', createLabel);
router.get('/labels/chat/:chatId', getChatLabels);
router.post('/labels/:id/apply', applyLabel);
router.delete('/labels/:id', deleteLabel);

// Quick replies
router.get('/quick-replies', listQuickReplies);
router.post('/quick-replies', createQuickReply);
router.patch('/quick-replies/:id', updateQuickReply);
router.delete('/quick-replies/:id', deleteQuickReply);

export default router;
