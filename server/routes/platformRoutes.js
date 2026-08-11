import express from 'express';
import { appSecretAuth } from '../utils/appAuth.js';
import {
  upsertAppUser,
  issueUserToken,
  listAppUsers,
  deactivateAppUser,
} from '../controllers/platformController.js';

/**
 * The embeddable-platform API, called by a host product's BACKEND.
 *
 * Authenticated with the tenant's app secret (X-CC-App-Id + Bearer <secret>),
 * NOT with a user session — these endpoints act on behalf of a whole tenant, so
 * they must never be reachable from a browser. The token this mints is what a
 * browser is given, and it only ever speaks for one end user.
 *
 * Mounted at /api/v1/platform.
 */
const router = express.Router();

router.use(appSecretAuth);

// Who am I? Lets an integrator verify their credentials in one call.
router.get('/whoami', (req, res) =>
  res.json({
    success: true,
    app: {
      appId: req.app_.appId,
      name: req.app_.name,
      features: req.app_.features,
      limits: req.app_.limits,
      active: req.app_.active,
    },
  })
);

router.post('/users', upsertAppUser); // idempotent upsert by externalId
router.get('/users', listAppUsers);
router.delete('/users/:externalId', deactivateAppUser);

router.post('/tokens', issueUserToken); // short-lived end-user token

export default router;
