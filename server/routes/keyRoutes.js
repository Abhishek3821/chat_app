import { Router } from 'express';
import { listKeys, createKey, revokeKey } from '../controllers/apiKeyController.js';
import { protect, adminOnly } from '../middleware/auth.js';

const router = Router();
// API keys grant programmatic access to chats, messages & contacts, so they're
// restricted to platform admins (the developer running the deployment). Regular
// workspace members just use the chat app — they can't mint or manage keys.
router.use(protect, adminOnly);

router.get('/', listKeys);
router.post('/', createKey);
router.delete('/:id', revokeKey);

export default router;
