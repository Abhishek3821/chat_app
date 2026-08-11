import { Router } from 'express';
import {
  getMyIdentity,
  publishIdentity,
  rewrapIdentity,
  getChatMemberKeys,
  getMyChatKeys,
  enableEncryption,
  rotateKey,
  disableEncryption,
} from '../controllers/e2eeController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

// Identity (your own key pair)
router.get('/me', getMyIdentity);
router.post('/identity', publishIdentity);
router.patch('/identity', rewrapIdentity);

// Per-chat key distribution
router.get('/chats/:chatId/members', getChatMemberKeys);
router.get('/chats/:chatId/keys', getMyChatKeys);
router.post('/chats/:chatId/enable', enableEncryption);
router.post('/chats/:chatId/rotate', rotateKey);
router.post('/chats/:chatId/disable', disableEncryption);

export default router;
