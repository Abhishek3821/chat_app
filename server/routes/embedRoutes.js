import { Router } from 'express';
import { getEmbedConfig, getIceServers } from '../controllers/embedController.js';
import { protect } from '../middleware/auth.js';

/**
 * Drop-in embed support. Mounted at /api/v1/embed.
 *
 * `/config` is public (app id only) because the browser needs it before it has a
 * user token. `/ice` is authenticated because it mints billable relay credentials.
 */
const router = Router();

router.get('/config', getEmbedConfig);
router.get('/ice', protect, getIceServers);

export default router;
