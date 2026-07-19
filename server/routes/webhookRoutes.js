import { Router } from 'express';
import { listWebhooks, createWebhook, deleteWebhook, receiveWebhook } from '../controllers/webhookController.js';
import { protect } from '../middleware/auth.js';

// Authenticated management of incoming webhooks (owned via group membership).
export const webhookRoutes = Router();
webhookRoutes.use(protect);
webhookRoutes.get('/', listWebhooks);
webhookRoutes.post('/', createWebhook);
webhookRoutes.delete('/:id', deleteWebhook);

// PUBLIC ingress: the unguessable token in the URL IS the credential, so this
// router has NO `protect`. Mounted at /api/hooks.
export const hookIngressRoutes = Router();
hookIngressRoutes.post('/:token', receiveWebhook);
