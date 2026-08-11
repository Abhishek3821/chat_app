import { Router } from 'express';
import {
  startCall,
  startDirectCall,
  endCall,
  missCall,
  rejectCall,
  updateCall,
  getCallHistory,
} from '../controllers/callController.js';
import { protect } from '../middleware/auth.js';
import { requireFeature } from '../utils/appAuth.js';

const router = Router();
router.use(protect); // every call API requires an authenticated session
// Embedded tenants only get capabilities their App has been granted; a
// first-party user has no tenant, so this is a no-op for them.
router.use(requireFeature('calls'));

router.get('/', getCallHistory);
router.get('/history', getCallHistory);
router.post('/start', startDirectCall);
router.post('/end', endCall);
router.post('/missed', missCall);
router.post('/reject', rejectCall);

// Legacy/group endpoints kept for compatibility.
router.post('/', startCall);
router.patch('/:id', updateCall);

export default router;
