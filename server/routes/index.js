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
import pushRoutes from './pushRoutes.js';
import communityRoutes from './communityRoutes.js';
import catalogRoutes from './catalogRoutes.js';
import agentRoutes from './agentRoutes.js';
import broadcastRoutes from './broadcastRoutes.js';
import liveLocationRoutes from './liveLocationRoutes.js';

const router = Router();

router.get('/health', (req, res) => {
  const dbUp = mongoose.connection.readyState === 1; // 1 = connected
  res.status(dbUp ? 200 : 503).json({
    success: dbUp,
    service: 'ChatConnect API',
    db: dbUp ? 'connected' : 'disconnected',
    email: isEmailConfigured() ? 'configured' : 'not_configured',
    time: new Date(),
  });
});

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
router.use('/keys', keyRoutes); // manage your own API keys (JWT)
router.use('/v1', v1Routes); // public third-party API (X-API-Key)

export default router;
