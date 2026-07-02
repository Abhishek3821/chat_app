import { Router } from 'express';
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

const router = Router();

router.get('/health', (req, res) => res.json({ success: true, service: 'ChatConnect API', time: new Date() }));

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

export default router;
