import { Router } from 'express';
import mongoose from 'mongoose';
import { isEmailConfigured } from '../utils/sendEmail.js';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import chatRoutes from './chatRoutes.js';
import messageRoutes from './messageRoutes.js';
import groupRoutes from './groupRoutes.js';
import callRoutes from './callRoutes.js';
import meetingRoutes from './meetingRoutes.js';
import statusRoutes from './statusRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import contactRoutes from './contactRoutes.js';
import reportRoutes from './reportRoutes.js';
import uploadRoutes from './uploadRoutes.js';
import adminRoutes from './adminRoutes.js';
import workspaceRoutes from './workspaceRoutes.js';
import keyRoutes from './keyRoutes.js';
import v1Routes from './v1Routes.js';
import appRoutes from './appRoutes.js';
import platformRoutes from './platformRoutes.js';
import embedRoutes from './embedRoutes.js';
import { getIceServers } from '../controllers/embedController.js';
import { protect } from '../middleware/auth.js';
import pushRoutes from './pushRoutes.js';
import communityRoutes from './communityRoutes.js';
import catalogRoutes from './catalogRoutes.js';
import agentRoutes from './agentRoutes.js';
import broadcastRoutes from './broadcastRoutes.js';
import liveLocationRoutes from './liveLocationRoutes.js';
import searchRoutes from './searchRoutes.js';
import { webhookRoutes, hookIngressRoutes } from './webhookRoutes.js';

const router = Router();

/* Build identity, resolved once at boot.
   An integrator could not previously tell WHICH code a given host was running,
   so a fix verified against the source could not be confirmed as deployed —
   the only way to find out was to retest the integration by hand. Surfacing the
   commit makes "is this host running the change?" a single GET.
   Platform env vars are checked first so this needs no build step. */
const BUILD_COMMIT = (
  process.env.GIT_COMMIT ||
  process.env.RENDER_GIT_COMMIT ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.SOURCE_VERSION ||
  ''
).slice(0, 12);
const BOOTED_AT = new Date();

router.get('/health', (req, res) => {
  const dbUp = mongoose.connection.readyState === 1; // 1 = connected
  res.status(dbUp ? 200 : 503).json({
    success: dbUp,
    service: 'ChatKonect API',
    db: dbUp ? 'connected' : 'disconnected',
    email: isEmailConfigured() ? 'configured' : 'not_configured',
    // `unknown` means the host's platform exposes no commit var — not that it is
    // stale. Set GIT_COMMIT explicitly in that case.
    commit: BUILD_COMMIT || 'unknown',
    bootedAt: BOOTED_AT,
    time: new Date(),
  });
});

// Drop-in embed: bootstrap config (public, app id only) + minted ICE servers.
router.use('/v1/embed', embedRoutes);
/* The same minted ICE servers for the FIRST-PARTY app. Server-side TURN was
   originally added for the embed only, so configuring TURN_URL fixed embeds
   while leaving this app STUN-only — two places to configure, one of them
   silent when missed. Registered before the `/v1` API-key router so this exact
   path is not shadowed by it. */
router.get('/v1/ice', protect, getIceServers);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/chats', chatRoutes);
router.use('/messages', messageRoutes);
router.use('/groups', groupRoutes);
router.use('/calls', callRoutes);
router.use('/meetings', meetingRoutes);
router.use('/status', statusRoutes);
router.use('/notifications', notificationRoutes);
router.use('/contacts', contactRoutes);
router.use('/reports', reportRoutes);
router.use('/upload', uploadRoutes);
router.use('/admin', adminRoutes);
router.use('/workspaces', workspaceRoutes); // multi-tenant org management
router.use('/push', pushRoutes); // Web Push subscriptions (notifications)
router.use('/communities', communityRoutes); // groups-of-groups + announcements
router.use('/catalog', catalogRoutes); // WhatsApp-Business product catalog
router.use('/agent', agentRoutes); // agent tools: labels + quick replies
router.use('/broadcasts', broadcastRoutes); // broadcast lists (one-to-many DMs)
router.use('/live-location', liveLocationRoutes); // real-time location sharing
router.use('/search', searchRoutes); // one search across people/chats/messages/meetings
router.use('/webhooks', webhookRoutes); // manage incoming webhooks (group members)
router.use('/hooks', hookIngressRoutes); // PUBLIC token-authed message ingress
router.use('/keys', keyRoutes); // manage your own API keys (JWT)
router.use('/apps', appRoutes); // embeddable-platform TENANT management (admin console)
router.use('/v1/platform', platformRoutes); // tenant backend: provision users + mint user tokens
router.use('/v1', v1Routes); // public third-party API (X-API-Key)

export default router;
